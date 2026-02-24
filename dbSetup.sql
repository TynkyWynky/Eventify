CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50) UNIQUE NOT NULL,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    first_name      VARCHAR(100),
    last_name       VARCHAR(100),
    phone           VARCHAR(20),
    is_active       BOOLEAN DEFAULT TRUE,
    is_admin        BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_login      TIMESTAMP WITH TIME ZONE
);

-- Indexes for users table
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_active ON users(is_active);

-- ============================================
-- EVENTS TABLE (with API sync support)
-- ============================================
CREATE TABLE events (
    id              SERIAL PRIMARY KEY,
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    
    -- When
    start_datetime  TIMESTAMP WITH TIME ZONE NOT NULL,
    end_datetime    TIMESTAMP WITH TIME ZONE,
    timezone        VARCHAR(50) DEFAULT 'UTC',
    
    -- Where
    venue_name      VARCHAR(255),
    address         TEXT,
    city            VARCHAR(100),
    state           VARCHAR(100),
    country         VARCHAR(100) DEFAULT 'USA',
    postal_code     VARCHAR(20),
    latitude        DECIMAL(10, 8),
    longitude       DECIMAL(11, 8),
    is_virtual      BOOLEAN DEFAULT FALSE,
    virtual_link    VARCHAR(500),
    
    -- Cost
    is_free         BOOLEAN DEFAULT FALSE,
    cost            DECIMAL(10, 2),
    currency        VARCHAR(3) DEFAULT 'USD',
    ticket_url      VARCHAR(500),
    
    -- Organization
    organizer_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    category        VARCHAR(100),
    tags            TEXT[], -- Array of tags
    
    -- Status
    status          VARCHAR(20) DEFAULT 'draft' 
                    CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
    capacity        INTEGER, -- Max attendees, NULL = unlimited
    
    -- Media
    cover_image_url VARCHAR(500),
    
    -- API SYNC FIELDS (NEW!)
    source          VARCHAR(50),           -- e.g., 'ticketmaster', 'setlistfm'
    source_id       VARCHAR(255),          -- Original ID from source API
    source_url      VARCHAR(500),          -- Link to original event
    source_metadata JSONB,                 -- Raw source payload (scraped/API)
    
    -- Timestamps
    created_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    published_at    TIMESTAMP WITH TIME ZONE,
    
    -- Constraint: prevent duplicate events from same source
    CONSTRAINT unique_source_event UNIQUE (source, source_id)
);

-- Indexes for events table
CREATE INDEX idx_events_start_datetime ON events(start_datetime);
CREATE INDEX idx_events_status ON events(status);
CREATE INDEX idx_events_organizer ON events(organizer_id);
CREATE INDEX idx_events_category ON events(category);
CREATE INDEX idx_events_city ON events(city);
CREATE INDEX idx_events_is_free ON events(is_free);
CREATE INDEX idx_events_tags ON events USING GIN(tags);
CREATE INDEX idx_events_source ON events(source);
CREATE INDEX idx_events_source_id ON events(source_id);

-- ============================================
-- EVENT REGISTRATIONS (Many-to-Many: Users <-> Events)
-- ============================================
CREATE TABLE event_registrations (
    id              SERIAL PRIMARY KEY,
    event_id        INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    registered_at   TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status          VARCHAR(20) DEFAULT 'registered' 
                    CHECK (status IN ('registered', 'attended', 'cancelled', 'no_show')),
    notes           TEXT,
    
    UNIQUE(event_id, user_id) -- Prevent duplicate registrations
);

CREATE INDEX idx_registrations_event ON event_registrations(event_id);
CREATE INDEX idx_registrations_user ON event_registrations(user_id);

CREATE TABLE sync_logs (
    id              SERIAL PRIMARY KEY,
    started_at      TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at    TIMESTAMP WITH TIME ZONE,
    status          VARCHAR(20) DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
    events_fetched  INTEGER DEFAULT 0,
    events_inserted INTEGER DEFAULT 0,
    events_updated  INTEGER DEFAULT 0,
    events_failed   INTEGER DEFAULT 0,
    error_message   TEXT,
    duration_ms     INTEGER
);

CREATE INDEX idx_sync_logs_status ON sync_logs(status);
CREATE INDEX idx_sync_logs_started ON sync_logs(started_at);


-- Function to hash password using bcrypt
CREATE OR REPLACE FUNCTION hash_password(plain_password TEXT)
RETURNS TEXT AS $$
BEGIN
    RETURN crypt(plain_password, gen_salt('bf', 10));
END;
$$ LANGUAGE plpgsql;

-- Function to verify password
CREATE OR REPLACE FUNCTION verify_password(plain_password TEXT, hashed_password TEXT)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN hashed_password = crypt(plain_password, hashed_password);
END;
$$ LANGUAGE plpgsql;

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers to auto-update updated_at
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_events_updated_at
    BEFORE UPDATE ON events
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();


-- View: Upcoming events with organizer info
CREATE VIEW upcoming_events AS
SELECT 
    e.*,
    u.username as organizer_username,
    u.email as organizer_email,
    COUNT(er.id) as registered_count
FROM events e
LEFT JOIN users u ON e.organizer_id = u.id
LEFT JOIN event_registrations er ON e.id = er.event_id AND er.status = 'registered'
WHERE e.start_datetime > CURRENT_TIMESTAMP
    AND e.status = 'published'
GROUP BY e.id, u.username, u.email;

-- View: User's registered events
CREATE VIEW user_event_registrations AS
SELECT 
    er.*,
    e.title as event_title,
    e.start_datetime,
    e.end_datetime,
    e.venue_name,
    e.city,
    e.is_virtual,
    u.username,
    u.email
FROM event_registrations er
JOIN events e ON er.event_id = e.id
JOIN users u ON er.user_id = u.id;

-- View: API-synced events summary
CREATE VIEW api_synced_events AS
SELECT 
    source,
    COUNT(*) as total_events,
    COUNT(CASE WHEN status = 'published' AND start_datetime > CURRENT_TIMESTAMP THEN 1 END) as upcoming,
    COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
    MIN(created_at) as first_synced,
    MAX(updated_at) as last_updated
FROM events
WHERE source IS NOT NULL
GROUP BY source;


-- Insert sample users (password: 'password123')
INSERT INTO users (username, email, password_hash, first_name, last_name, is_admin) VALUES
('admin', 'admin@events.com', crypt('password123', gen_salt('bf', 10)), 'Admin', 'User', TRUE),
('sync_bot', 'sync@events.com', crypt('sync_password_123', gen_salt('bf', 10)), 'Sync', 'Bot', FALSE),
('john_doe', 'john@example.com', crypt('password123', gen_salt('bf', 10)), 'John', 'Doe', FALSE),
('jane_smith', 'jane@example.com', crypt('password123', gen_salt('bf', 10)), 'Jane', 'Smith', FALSE);

-- Insert sample events (manual events without source)
INSERT INTO events (title, description, start_datetime, end_datetime, venue_name, address, city, cost, category, tags, organizer_id, status, capacity) VALUES
('Tech Conference 2025', 'Annual technology conference', '2025-06-15 09:00:00+00', '2025-06-15 17:00:00+00', 'Convention Center', '123 Main St', 'San Francisco', 299.99, 'Technology', ARRAY['tech', 'conference', 'networking'], 1, 'published', 500),
('Free Workshop: Web Dev', 'Learn web development basics', '2025-03-20 14:00:00+00', '2025-03-20 16:00:00+00', 'Community Center', '456 Oak Ave', 'New York', 0, 'Education', ARRAY['webdev', 'free', 'workshop'], 3, 'published', 50),
('Music Festival', 'Outdoor music festival', '2025-07-04 12:00:00+00', '2025-07-04 23:00:00+00', 'Central Park', 'Park Ave', 'Austin', 75.00, 'Music', ARRAY['music', 'festival', 'outdoor'], 4, 'draft', 1000);

-- Insert sample registrations
INSERT INTO event_registrations (event_id, user_id, status) VALUES
(1, 3, 'registered'),
(1, 4, 'registered'),
(2, 4, 'registered');
