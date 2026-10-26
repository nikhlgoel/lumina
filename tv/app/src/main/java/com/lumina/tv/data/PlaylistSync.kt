package com.lumina.tv.data

import android.util.Log
import com.lumina.tv.core.PlaylistLogic
import com.lumina.tv.download.DownloadManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.schabi.newpipe.extractor.Page
import org.schabi.newpipe.extractor.ServiceList
import org.schabi.newpipe.extractor.playlist.PlaylistInfo
import org.schabi.newpipe.extractor.stream.StreamInfoItem

/** One playlist as fetched right now: its name, and every entry as something that can be downloaded. */
data class FetchedPlaylist(val title: String, val tracks: List<Track>, val description: String? = null, val thumbnailUrl: String? = null)

/** Where a playlist's contents come from. Two kinds: a public link, or the signed-in account. */
interface PlaylistFetcher {
    suspend fun fetch(id: String, kind: MediaKind): FetchedPlaylist
}

/** Public and unlisted playlists, by link, through the same extractor as search. No sign-in. */
class PublicPlaylistFetcher : PlaylistFetcher {
    override suspend fun fetch(id: String, kind: MediaKind): FetchedPlaylist = withContext(Dispatchers.IO) {
        val service = ServiceList.YouTube
        val url = PlaylistLogic.canonicalUrl(id)
        val info = PlaylistInfo.getInfo(service, url)
        val items = ArrayList<StreamInfoItem>(info.relatedItems.filterIsInstance<StreamInfoItem>())
        var next: Page? = if (info.hasNextPage()) info.nextPage else null
        // Long playlists come in pages. Bounded, so a runaway list cannot loop forever.
        var pages = 0
        while (next != null && pages++ < MAX_PAGES && items.size < MAX_ITEMS) {
            val page = PlaylistInfo.getMoreItems(service, url, next)
            items += page.items.filterIsInstance<StreamInfoItem>()
            next = if (page.hasNextPage()) page.nextPage else null
        }
        val tracks = items.map { Track(it.url, it.name, PlaylistLogic.cleanArtist(it.uploaderName), it.duration.coerceAtLeast(0), it.thumbnails.firstOrNull { img -> img.url.isNotBlank() }?.url, kind) }
        FetchedPlaylist(
            info.name.orEmpty().ifBlank { "Playlist" },
            tracks,
            // The owner's own words about the playlist, when there are any. Never allowed to fail the whole fetch.
            description = runCatching { info.description?.content }.getOrNull().let(PlaylistLogic::plainText),
            // The playlist's own artwork first; the first song's picture is the fallback.
            thumbnailUrl = runCatching { info.thumbnails.firstOrNull { img -> img.url.isNotBlank() }?.url }.getOrNull() ?: tracks.firstNotNullOfOrNull { it.thumbnailUrl },
        )
    }

    private companion object {
        const val MAX_PAGES = 60
        const val MAX_ITEMS = 5000
    }
}

/** The signed-in person's own playlists, including private ones, through the official API. */
class AccountPlaylistFetcher(private val api: YouTubeApi) : PlaylistFetcher {
    override suspend fun fetch(id: String, kind: MediaKind): FetchedPlaylist {
        val title = api.myPlaylists().firstOrNull { it.id == id }?.title ?: "Playlist"
        val tracks = api.items(id).map {
            Track("https://www.youtube.com/watch?v=${it.videoId}", it.title, PlaylistLogic.cleanArtist(it.channel), 0, it.thumbnail, kind)
        }
        return FetchedPlaylist(title, tracks)
    }
}

/**
 * Keeps playlists in step with the stick: look at what is in each one now, and download whatever the
 * library does not have. Runs on demand, when the app opens if it has been a while, and every few hours
 * in the background.
 *
 * It decides by comparing against the *library*, not against a list of what it did last time. That is
 * what makes it robust: a download that failed is simply wanted again at the next sync, a song deleted
 * by hand stays deleted (it is excluded), and nothing needs to be repaired after a crash.
 */
class PlaylistSync(
    private val store: PlaylistStore,
    private val library: LibraryStore,
    private val downloads: DownloadManager,
    private val publicFetcher: PlaylistFetcher,
    private val accountFetcher: PlaylistFetcher,
    private val settings: AppSettings,
    private val now: () -> Long = System::currentTimeMillis,
    /** The song lists of saved playlists, so one opens at once and a long one is not fetched again for nothing. */
    private val cache: PlaylistTracksCache? = null,
) {
    data class Report(val playlist: String, val queued: Int, val error: String?)

    private fun fetcherFor(source: PlaylistSource) = if (source == PlaylistSource.ACCOUNT) accountFetcher else publicFetcher

    /** Look inside a playlist before adding it, so the person can be told how big it is. */
    suspend fun preview(id: String, source: PlaylistSource, kind: MediaKind): FetchedPlaylist = fetcherFor(source).fetch(id, kind)

    sealed interface AddOutcome {
        data class Added(val playlist: SyncedPlaylist, val message: String) : AddOutcome
        data class Refused(val message: String) : AddOutcome
    }

    /**
     * The whole "someone pasted a link" path, with every refusal said in plain words. Used by the phone page,
     * which cannot ask a follow-up question, so it has to decide safely on its own: if fetching everything
     * would not fit on the drive, it quietly switches to "only new ones from now" and says so.
     */
    suspend fun addFromLink(input: String, kind: MediaKind, alsoDownload: Boolean, freeBytes: Long): AddOutcome {
        val id = when (val parsed = PlaylistLogic.parse(input)) {
            is PlaylistLogic.Parsed.Ok -> parsed.id
            PlaylistLogic.Parsed.Mix -> return AddOutcome.Refused("That's a YouTube Mix. It is generated fresh each time, so there is nothing fixed to keep in sync. Use a normal playlist.")
            PlaylistLogic.Parsed.Invalid -> return AddOutcome.Refused("That doesn't look like a playlist link. It should contain list= or start with PL.")
        }
        if (store.playlists.value.any { it.id == id }) return AddOutcome.Refused("That playlist is already in your playlists.")
        val fetched = try {
            publicFetcher.fetch(id, kind)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            return AddOutcome.Refused("Couldn't open that playlist. If it is private, sign in with your account on the TV and add it from there. (${e.message ?: "no details"})")
        }
        if (fetched.tracks.isEmpty()) return AddOutcome.Refused("That playlist is empty or has nothing that can be played.")

        val count = fetched.tracks.size
        val bytes = PlaylistLogic.estimateAudioBytes(fetched.tracks.sumOf { it.durationSec })
        // Adding is saving: the playlist appears with its cover, name and songs, and plays from the internet.
        // Copying every song onto the stick is a separate choice, made on purpose, and only if it fits.
        val fits = freeBytes <= 0 || kind != MediaKind.AUDIO || bytes < freeBytes * 7 / 10
        val download = alsoDownload && fits
        val playlist = if (download) add(id, PlaylistSource.PUBLIC, kind, fetched, true) else save(id, PlaylistSource.PUBLIC, kind, fetched)
        val base = "Added “${fetched.title}” ($count songs) to your playlists. Open it from Playlists or Home to play it."
        val note = when {
            download -> "$base Its songs are also downloading to the TV (about ${bytes / 1_000_000} MB)."
            alsoDownload -> "$base Keeping every song would be about ${bytes / 1_000_000} MB, more than the free space allows, so it is saved for streaming only."
            else -> base
        }
        return AddOutcome.Added(playlist, note)
    }

    /**
     * Put a playlist in the person's playlists WITHOUT downloading anything: its cover, name, description and song list are
     * kept, it shows up wherever playlists are shown, and it plays from the internet. [setDownload] turns copying on later.
     */
    suspend fun save(id: String, source: PlaylistSource, kind: MediaKind, fetched: FetchedPlaylist): SyncedPlaylist {
        val playlist = SyncedPlaylist(
            id, fetched.title, source, kind, now(), fetched.tracks.size, emptySet(), null,
            thumbnailUrl = fetched.thumbnailUrl ?: fetched.tracks.firstNotNullOfOrNull { it.thumbnailUrl },
            download = false, description = fetched.description,
        )
        cache?.write(id, fetched.tracks)
        store.upsert(playlist)
        return playlist
    }

    /** The songs last saved for a playlist, so its page can open at once and be refreshed behind. Empty when never saved. */
    suspend fun cachedTracks(id: String): List<Track> = cache?.read(id).orEmpty()

    /**
     * Turn copying a saved playlist onto the stick on or off. On: [downloadExisting] says whether what is in it today is
     * fetched too, or only what is added from now on. Off: songs already downloaded stay; nothing new is fetched.
     */
    suspend fun setDownload(id: String, on: Boolean, downloadExisting: Boolean) {
        val p = store.playlists.value.firstOrNull { it.id == id } ?: return
        if (!on) { store.update(id) { it.copy(download = false) }; return }
        val listed = (cache?.read(id) ?: emptyList()).map { it.id }.toSet()
        store.update(id) { it.copy(download = true, excludedIds = if (downloadExisting) emptySet() else p.excludedIds + listed) }
        syncOne(id)
    }

    /** Take a playlist out of the person's playlists. Songs already on the stick are not deleted. */
    suspend fun remove(id: String) {
        store.remove(id)
        cache?.delete(id)
    }

    /**
     * Start keeping a playlist in sync. [downloadExisting] says what to do about what is in it today: fetch
     * all of it, or treat today's contents as already dealt with and fetch only what is added from now on.
     */
    suspend fun add(id: String, source: PlaylistSource, kind: MediaKind, fetched: FetchedPlaylist, downloadExisting: Boolean): SyncedPlaylist {
        val excluded = if (downloadExisting) emptySet() else fetched.tracks.map { it.id }.toSet()
        val playlist = SyncedPlaylist(id, fetched.title, source, kind, 0, fetched.tracks.size, excluded, null, fetched.thumbnailUrl, download = true, description = fetched.description)
        cache?.write(id, fetched.tracks)
        store.upsert(playlist)
        return syncOne(id).first ?: playlist
    }

    suspend fun syncAll(force: Boolean = false, intervalMs: Long = DEFAULT_INTERVAL_MS): List<Report> {
        val reports = ArrayList<Report>()
        for (p in store.playlists.value) {
            if (!force && !PlaylistLogic.isDue(p.lastSyncMs, now(), intervalMs)) continue
            val (after, queued) = syncOne(p.id)
            reports += Report(p.title, queued, after?.lastError)
        }
        return reports
    }

    /** Sync one playlist. Returns the updated record, or null if it is no longer in the list. */
    suspend fun sync(id: String): SyncedPlaylist? = syncOne(id).first

    /** The updated record and how many downloads this pass started. */
    private suspend fun syncOne(id: String): Pair<SyncedPlaylist?, Int> {
        val p = store.playlists.value.firstOrNull { it.id == id } ?: return null to 0
        return try {
            val fetched = fetcherFor(p.source).fetch(p.id, p.mode)
            cache?.write(p.id, fetched.tracks)
            var started = 0
            // A playlist that is only saved is refreshed (name, count, songs, cover) but never downloaded.
            if (p.download) {
                val inLibrary = library.items.value.filter { it.kind == p.mode }.map { Track.idFromUrl(it.sourceUrl) }.toSet()
                val wantedIds = PlaylistLogic.newIds(fetched.tracks.map { it.id }, inLibrary + p.excludedIds).toSet()
                val wanted = fetched.tracks.filter { it.id in wantedIds }.take(MAX_PER_SYNC)
                // Capped per pass so a huge playlist does not become hundreds of queue rows at once; the
                // remainder is still wanted, so the next pass carries on.
                for (t in wanted) if (downloads.enqueue(t, p.mode) == DownloadManager.Outcome.QUEUED) started++
            }
            val updated = p.copy(
                title = fetched.title, lastSyncMs = now(), itemCount = fetched.tracks.size, lastError = null,
                thumbnailUrl = fetched.thumbnailUrl ?: fetched.tracks.firstNotNullOfOrNull { it.thumbnailUrl } ?: p.thumbnailUrl,
                description = fetched.description ?: p.description,
            )
            store.update(p.id) { updated }
            updated to started
        } catch (e: CancellationException) {
            throw e
        } catch (e: Throwable) {
            Log.w(TAG, "Sync failed for ${p.title}", e)
            val message = e.message?.takeIf { it.isNotBlank() } ?: "Couldn't reach the playlist."
            store.update(p.id) { it.copy(lastError = message) }
            store.playlists.value.firstOrNull { it.id == id } to 0
        }
    }

    companion object {
        private const val TAG = "PlaylistSync"
        const val DEFAULT_INTERVAL_MS = 6L * 60 * 60 * 1000
        private const val MAX_PER_SYNC = 60
    }
}
