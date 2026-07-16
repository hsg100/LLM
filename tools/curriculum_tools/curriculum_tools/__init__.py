"""FieldMap curriculum compiler.

Single owner of curriculum parsing, validation and compilation
(docs/PHASE_2_TECHNICAL_DESIGN.md §2). Sources under curriculum/ are the
only truth; the committed artifacts under curriculum/build/ are compiled,
never hand-edited, and CI drift-gates them against the sources.
"""

GRADING_CANARY = "__FIELDMAP_GRADING_CANARY__"
CATALOG_FORMAT = 1
