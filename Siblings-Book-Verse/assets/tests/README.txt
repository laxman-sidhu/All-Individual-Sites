Twelve suites, all plain Node. Nothing to install, no package.json.

    for f in assets/tests/*.test.mjs; do node "$f"; done

179 assertions. Node prints a "module type is not specified" warning first;
that is the absence of a package.json, not a problem with the code.

harness.mjs holds the browser stubs and the fixture workbook. The fixture rows
are a slice of the real sheet, because the cases that matter only show up in
real data: The Alchemist read by two people, "Read by Who ?" with its space
before the question mark, "Héctor García & Francesc Miralles" as one cell, and
a row with no author at all.

What each one is for
--------------------
identity   Normalisation across Latin, Devanagari and Japanese; title+author as
           the identity; the rule that a blank author says nothing rather than
           saying "no author".

csv        The published-sheet parser, used when the bridge is unreachable.
           Quoted commas, newlines inside a cell, doubled quotes - all three
           appear in the real summaries.

sheets     Column mapping from the real header row. Reordering, the unnamed
           spacer, every spelling of the reader column, and two columns naming
           one field.

library    The shape everything else depends on: many rows becoming one entry
           per book with a list of readers. Shelf narrowing, summaries keeping
           their line breaks, and every apply* path including the ones that
           must REFUSE.

api        Both API shapes normalised into one. The per-source oddities are all
           here - http covers, page-curl overlays, HTML descriptions, category
           paths, cover_i versus cover_id.

discover   Which ENDPOINT each search scope calls, and with what parameters.
           These assert the REQUESTS rather than the results, because that is
           the whole feature. A test that only checked titles would pass just
           as happily on a call that searched the wrong index.

cards      Card markup. Mostly the fallback-behind-cover pattern, which is
           invisible when it breaks - the title simply prints over the artwork.

writer     What actually lands in a cell. The failure mode here is a row that
           saves perfectly and is simply missing a column - no error, no toast,
           nothing to notice until someone opens the sheet weeks later.

bridge     The browser and Code.gs agreeing, character by character. Run this
           after ANY change to Code.gs. The two hold the same rules twice on
           purpose, and drift is silent: the bridge writes to a row the site
           can no longer find.

versions   The three states on a card, and which claim each one makes. Green is
           the number on our row and nothing weaker; a title and an author
           agreeing is yellow, which is what stopped a search for one book we
           own coming back as ten green cards. The case worth having is still
           the one that was broken: a work whose edition list carries the number
           on the sheet while the number on its own cover carries nothing.

editions   The Other Versions cell itself, read and written. Every shape the
           real column holds - a publisher ending in a full stop, one with a
           comma and a dot inside it, a bare language code, a missing year, an
           ASIN that is not an ISBN. Also that the site writes the format it
           reads, that Code.gs reads it the same way, and that filing a printing
           reaches every row for that book.

css        The stylesheet itself. Unclosed blocks, classes emitted but never
           styled, images that would paint under their fallback, grid tracks
           with an auto minimum, and any typeable control that drops under 16px
           on a phone.

None of these has a layout engine, so they confirm structure and never
geometry.
