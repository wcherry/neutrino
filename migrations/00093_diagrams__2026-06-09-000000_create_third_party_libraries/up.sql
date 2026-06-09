-- Registry of imported third-party drawio shape libraries.
-- XML is stored in the private file store at .Private/{private_path}.
CREATE TABLE diagram_third_party_libraries (
    id           TEXT PRIMARY KEY NOT NULL,
    name         TEXT NOT NULL,
    url          TEXT NOT NULL,
    private_path TEXT NOT NULL,
    created_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at   TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_diagram_tpl_url ON diagram_third_party_libraries(url);
