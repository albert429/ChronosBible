"""Authoritative book table: data/books.json.

Rows are [USFM, OSIS-style, STEPBible, Arabic name] for the 66 books in
canonical order (39 Old Testament, then 27 New Testament). The JavaScript
counterpart is scripts/lib/books.js; tests/fixtures/book-table.json pins both
to the same expectations.
"""

import json
from pathlib import Path
from typing import NamedTuple

from .paths import ROOT

OLD_TESTAMENT_BOOKS = 39
BOOK_COUNT = 66


class Book(NamedTuple):
    usfm: str
    osis: str
    step: str
    name: str


def load_books(root: Path = ROOT) -> list:
    rows = json.loads((Path(root) / "data/books.json").read_text(encoding="utf-8"))
    books = [Book(*row) for row in rows]
    if len(books) != BOOK_COUNT or len({b.usfm for b in books}) != BOOK_COUNT:
        raise ValueError("data/books.json must list the 66 books once each")
    return books


def old_testament(books: list) -> list:
    return books[:OLD_TESTAMENT_BOOKS]


def new_testament(books: list) -> list:
    return books[OLD_TESTAMENT_BOOKS:]


def usfm_by_name(root: Path = ROOT) -> dict:
    """Arabic book name (as in the plan and Bible source) -> USFM code."""
    return {book.name: book.usfm for book in load_books(root)}


def usfm_by_step(books: list) -> dict:
    """STEPBible book abbreviation -> USFM code."""
    return {book.step: book.usfm for book in books}
