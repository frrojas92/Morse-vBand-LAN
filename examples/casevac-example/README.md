# Fictional Morse-vBand 9-Line CASEVAC example

This is synthetic training data, not a real evacuation request. The files show
the same column layout, detailed blocks, and final human-readable TX/RX
interaction produced by Morse-vBand LAN.
The log is viewed from student station `K1MED`, so its own transmissions are
`TX` and instructor station `INSTR` is `RX`.

The instructor selects the CASEVAC channel with **Transmitir aquí** and keys
Morse directly from the instructor portal as `INSTR`.

Demo interpretation:

- Line 1: fictional pickup grid `AB12345678`.
- Line 2: frequency `46.50` and callsign `K1MED` (sent without punctuation).
- Line 3: one urgent and one priority patient (`A1 C1`).
- Line 4: no special equipment (`A`).
- Line 5: one litter and one ambulatory patient (`L1 A1`).
- Line 6: no enemy troops near the pickup site (`N`).
- Line 7: pickup site marked with smoke (`C`).
- Line 8: two local/own-force military patients (`A2`).
- Line 9: terrain/conditions described as dust (`DUST`).

Local procedures and authorized forms take precedence over this fictional
example.
