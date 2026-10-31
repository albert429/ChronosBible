"""Shared helpers for the repository's Python tools (standard library only).

Entry-point scripts in scripts/<workflow>/ put scripts/lib on sys.path and
import from here; nothing in this package imports a script by file path.
Production builds never import it.
"""
