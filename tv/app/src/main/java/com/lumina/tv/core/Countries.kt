package com.lumina.tv.core

data class Country(val code: String, val name: String)

/** Countries a person can pick for "music from": it steers the Shuffle button and the extractor's region. */
object Countries {
    val all = listOf(
        Country("IN", "India"), Country("US", "United States"), Country("GB", "United Kingdom"), Country("CA", "Canada"),
        Country("AU", "Australia"), Country("DE", "Germany"), Country("FR", "France"), Country("ES", "Spain"),
        Country("IT", "Italy"), Country("BR", "Brazil"), Country("MX", "Mexico"), Country("JP", "Japan"),
        Country("KR", "South Korea"), Country("ID", "Indonesia"), Country("PH", "Philippines"), Country("PK", "Pakistan"),
        Country("BD", "Bangladesh"), Country("LK", "Sri Lanka"), Country("NP", "Nepal"), Country("AE", "United Arab Emirates"),
        Country("SA", "Saudi Arabia"), Country("TR", "Turkey"), Country("NG", "Nigeria"), Country("ZA", "South Africa"),
    )

    fun byCode(code: String?): Country? = all.firstOrNull { it.code.equals(code, ignoreCase = true) }

    /** The device's own country when it is on the list, else the United States: a sensible start nobody had to choose. */
    fun defaultFor(localeCountry: String?): Country = byCode(localeCountry) ?: all[1]
}
