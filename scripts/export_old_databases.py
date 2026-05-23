#!/usr/bin/env python3

import argparse
import os
import sqlite3
from pathlib import Path


OLD_DATABASES = [
    "auth/auth.db",
    "calendar/calendar.db",
    "docs/docs.db",
    "drive/drive.db",
    "notes/notes.db",
    "phtos/photos.db",
    "photos/photos.db",
    "sheets/sheets.db",
    "slides/slides.db",
]

SKIP_TABLES = {
    "__diesel_schema_migrations",
    "diesel_schema_migrations",
    "sqlite_sequence",
}


def open_database(path):
    uri = path.resolve().as_uri()
    for suffix in ("?mode=ro", "?mode=ro&immutable=1"):
        conn = sqlite3.connect(uri + suffix, uri=True)
        try:
            conn.execute("SELECT name FROM sqlite_master LIMIT 1").fetchone()
            return conn
        except sqlite3.Error:
            conn.close()
    return sqlite3.connect(path)


def quote_identifier(value):
    return '"' + value.replace('"', '""') + '"'


def tables(conn):
    rows = conn.execute(
        """
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
        ORDER BY name
        """
    )
    return [row[0] for row in rows if row[0] not in SKIP_TABLES]


def columns(conn, table):
    rows = conn.execute(f"PRAGMA table_info({quote_identifier(table)})")
    return [row[1] for row in rows]


def export_table(conn, table, out):
    table_name = quote_identifier(table)
    column_names = columns(conn, table)
    if not column_names:
        return

    quoted_columns = ", ".join(quote_identifier(column) for column in column_names)
    quoted_values = ", ".join(f"quote({quote_identifier(column)})" for column in column_names)

    for row in conn.execute(f"SELECT {quoted_values} FROM {table_name}"):
        values = ", ".join(row)
        out.write(f"INSERT INTO {table_name} ({quoted_columns}) VALUES ({values});\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--old-root", default="../neutrino-repos/data")
    parser.add_argument("-o", "--output", default="old-databases.sql")
    args = parser.parse_args()

    old_root = Path(args.old_root)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)

    with output.open("w", encoding="utf-8") as out:
        out.write("BEGIN TRANSACTION;\n")

        for database in OLD_DATABASES:
            path = old_root / database
            if not path.exists():
                continue

            conn = open_database(path)
            try:
                for table in tables(conn):
                    export_table(conn, table, out)
            finally:
                conn.close()

        out.write("COMMIT;\n")


if __name__ == "__main__":
    main()
