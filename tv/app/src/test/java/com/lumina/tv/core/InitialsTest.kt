package com.lumina.tv.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class InitialsTest {
    @Test fun `two words give two letters`() = assertEquals("AL", Initials.of("Ada Lovelace"))

    @Test fun `one word gives one letter`() = assertEquals("A", Initials.of("ada"))

    @Test fun `only the first two words count`() = assertEquals("AB", Initials.of("ann bea cat"))

    @Test fun `extra spaces and punctuation are ignored`() = assertEquals("JD", Initials.of("  (john)   -doe "))

    @Test fun `blank or symbols give nothing to show`() {
        assertNull(Initials.of(null))
        assertNull(Initials.of("   "))
        assertNull(Initials.of("-- ??"))
    }

    @Test fun `non-latin names work`() = assertEquals("РИ", Initials.of("рина иванова"))
}
