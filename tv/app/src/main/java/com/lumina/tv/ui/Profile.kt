package com.lumina.tv.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.tv.material3.Icon
import androidx.tv.material3.Text
import coil.compose.AsyncImage
import com.lumina.tv.Graph
import com.lumina.tv.core.Initials
import kotlinx.coroutines.CancellationException

/** Who is using the app: a name, and a picture when signed in with YouTube. Without a picture the name's initials stand in. */
class Profile(val name: String?, val avatar: String?, val signedIn: Boolean)

/**
 * The profile as it should look now. The saved name and picture show at once; when signed in, the account's real
 * channel name and picture are fetched and saved, so the next start has them before the network answers.
 */
@Composable
fun rememberProfile(graph: Graph, signedIn: Boolean, nameVersion: Int): Profile {
    var name by remember(signedIn, nameVersion) { mutableStateOf(graph.settings.profileName) }
    var avatar by remember(signedIn) { mutableStateOf(if (signedIn) graph.settings.profileAvatar else null) }
    LaunchedEffect(signedIn) {
        if (!signedIn) {
            graph.settings.profileAvatar = null
            avatar = null
            return@LaunchedEffect
        }
        try {
            graph.youtube.myChannel()?.let {
                graph.settings.profileName = it.name
                graph.settings.profileAvatar = it.avatar
                name = it.name
                avatar = it.avatar
            }
        } catch (e: CancellationException) {
            throw e
        } catch (_: Throwable) {
            // Offline or over quota: keep what is saved.
        }
    }
    return Profile(name, avatar, signedIn)
}

/** The round picture: the account's photo, else the initials on the accent colour, else a plain person. */
@Composable
fun Avatar(profile: Profile, size: Dp, modifier: Modifier = Modifier) {
    val initials = Initials.of(profile.name)
    Box(modifier.size(size).clip(CircleShape).background(LuminaColors.Amber), contentAlignment = Alignment.Center) {
        if (initials != null) {
            Text(initials, style = LuminaText.Row.copy(fontSize = (size.value * 0.4f).sp, fontWeight = FontWeight.Bold, color = LuminaColors.Bg))
        } else {
            Icon(Icons.Filled.Person, contentDescription = null, tint = LuminaColors.Bg, modifier = Modifier.size(size * 0.6f))
        }
        if (profile.avatar != null) AsyncImage(model = profile.avatar, contentDescription = "Profile picture", contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize())
    }
}

/** The avatar at the right end of the top row. Select opens the profile. */
@Composable
fun ProfileBadge(profile: Profile, onClick: () -> Unit, modifier: Modifier = Modifier) {
    FocusSurface(onClick = onClick, modifier = modifier.size(49.dp), shape = CircleShape, scaleOnFocus = 1.1f) {
        Avatar(profile, 49.dp)
    }
}

/** Who you are, and the one thing worth doing from here: sign in or out, or change the name. */
@Composable
fun ProfileDialog(profile: Profile, onDismiss: () -> Unit, onSignIn: () -> Unit, onSignOut: () -> Unit, onRename: () -> Unit) {
    val first = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { first.requestFocus() } }
    LDialog(onDismiss = onDismiss, width = 700.dp) {
        Row(horizontalArrangement = Arrangement.spacedBy(24.dp), verticalAlignment = Alignment.CenterVertically) {
            Avatar(profile, 96.dp)
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(profile.name ?: "Guest", style = LuminaText.DialogTitle, maxLines = 1)
                Text(if (profile.signedIn) "Signed in with YouTube" else "Not signed in. Sign in to see your own playlists and your picture here.", style = LuminaText.Body)
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            if (profile.signedIn) {
                LButton("Sign out", onSignOut, primary = true, modifier = Modifier.focusRequester(first))
            } else {
                LButton("Sign in with YouTube", onSignIn, primary = true, modifier = Modifier.focusRequester(first))
                LButton("Change name", onRename)
            }
        }
    }
}

/** Asks what to call the person. Used at first start and from the profile. [onDone] gets the name, trimmed. */
@Composable
fun NameDialog(title: String, body: String, initial: String, onDone: (String) -> Unit, onDismiss: () -> Unit, extra: @Composable (() -> Unit)? = null) {
    var text by remember { mutableStateOf(initial) }
    val field = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { field.requestFocus() } }
    LDialog(onDismiss = onDismiss, width = 760.dp) {
        Text(title, style = LuminaText.DialogTitle)
        Text(body, style = LuminaText.Body)
        SearchField(text, { text = it.take(40) }, { if (text.isNotBlank()) onDone(text.trim()) }, field, Modifier.fillMaxWidth(), placeholder = "Your name")
        Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            LButton("Continue", { onDone(text.trim()) }, primary = true, enabled = text.isNotBlank())
            extra?.invoke()
            LButton("Skip", onDismiss)
        }
    }
}
