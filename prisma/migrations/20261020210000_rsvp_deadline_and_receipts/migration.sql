-- 申し込み期限。空なら期限なし。期限の時刻以降は出欠の新規登録と変更を止める。
ALTER TABLE events ADD COLUMN rsvp_deadline TIMESTAMPTZ NULL;

-- 参加費の領収書。システムの利用枠決済とは別で、幹事が金額を入力して発行する。
CREATE TABLE receipts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    participant_id UUID NOT NULL UNIQUE REFERENCES participants(id) ON DELETE CASCADE,
    event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    addressee VARCHAR(100) NOT NULL,
    amount INTEGER NOT NULL CHECK (amount > 0),
    description VARCHAR(100) NOT NULL,
    issuer_name VARCHAR(100) NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_receipts_event ON receipts(event_id);
