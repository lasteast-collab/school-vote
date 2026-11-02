CREATE TABLE codes (
  code char(6) PRIMARY KEY CHECK (code ~ '^[0-9]{6}$'),
  picture smallint CHECK (picture BETWEEN 1 AND 3),
  used_at timestamptz,
  CHECK ((picture IS NULL) = (used_at IS NULL))
);
CREATE TABLE pictures (
  n smallint PRIMARY KEY CHECK (n BETWEEN 1 AND 3),
  title text NOT NULL DEFAULT '',
  mime text,
  data bytea,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pictures (n, title) VALUES
  (1, 'Ministry of Sport and Culture'),
  (2, 'Ministry of Health'),
  (3, 'Ministry of Education');
