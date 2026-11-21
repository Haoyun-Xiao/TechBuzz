CREATE TABLE x_account_activity (
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  tweet_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('authored', 'repost')),
  author text NOT NULL,
  url text NOT NULL,
  published_at timestamptz NOT NULL,
  body text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, tweet_id, kind)
);
