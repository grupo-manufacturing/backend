-- Groupo Manufacturing Platform Database Schema

-- ===========================================
-- AUTH TABLES
-- ===========================================

CREATE TABLE IF NOT EXISTS otp_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number VARCHAR(20) NOT NULL,
  otp_code_hash VARCHAR(64) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  attempts INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS user_sessions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID NOT NULL,
  profile_type VARCHAR(20) NOT NULL CHECK (profile_type IN ('buyer', 'manufacturer')),
  token_hash VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- ===========================================
-- PROFILE TABLES
-- ===========================================

CREATE TABLE IF NOT EXISTS buyer_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  buyer_identifier VARCHAR(50) UNIQUE,
  full_name VARCHAR(255),
  email VARCHAR(255),
  business_address TEXT,
  about_business TEXT,
  daily_design_generation_count INTEGER DEFAULT 0,
  last_design_generation_date DATE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manufacturer_profiles (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone_number VARCHAR(20) UNIQUE NOT NULL,
  manufacturer_id VARCHAR(50) UNIQUE,
  unit_name VARCHAR(255),
  business_type VARCHAR(100),
  gst_number VARCHAR(20),
  pan_number VARCHAR(20),
  product_types TEXT[] DEFAULT '{}',
  daily_capacity INTEGER DEFAULT 0,
  manufacturing_unit_image_url TEXT,
  msme_number VARCHAR(50),
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ===========================================
-- CHAT TABLES
-- ===========================================

CREATE TABLE IF NOT EXISTS conversations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  buyer_id UUID NOT NULL REFERENCES buyer_profiles(id) ON DELETE CASCADE,
  manufacturer_id UUID NOT NULL REFERENCES manufacturer_profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_message_at TIMESTAMP WITH TIME ZONE,
  last_message_text TEXT,
  is_archived BOOLEAN DEFAULT FALSE,
  CONSTRAINT uq_conversation_participants UNIQUE (buyer_id, manufacturer_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_role VARCHAR(20) NOT NULL CHECK (sender_role IN ('buyer', 'manufacturer')),
  sender_id UUID NOT NULL,
  body TEXT NOT NULL,
  requirement_id UUID REFERENCES requirements(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_read BOOLEAN DEFAULT FALSE,
  client_temp_id VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_url TEXT NOT NULL,
  mime_type VARCHAR(255),
  size_bytes INTEGER,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ===========================================
-- REQUIREMENTS TABLES
-- ===========================================

CREATE TABLE IF NOT EXISTS requirements (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  buyer_id UUID NOT NULL REFERENCES buyer_profiles(id) ON DELETE CASCADE,
  requirement_no VARCHAR(50) UNIQUE NOT NULL,
  requirement_text TEXT,
  quantity INTEGER,
  product_type VARCHAR(255),
  product_link TEXT,
  image_url TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS requirement_responses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requirement_id UUID NOT NULL REFERENCES requirements(id) ON DELETE CASCADE,
  manufacturer_id UUID NOT NULL REFERENCES manufacturer_profiles(id) ON DELETE CASCADE,
  quoted_price DECIMAL(10, 2) NOT NULL,
  price_per_unit DECIMAL(10, 2) NOT NULL,
  delivery_time VARCHAR(255) NOT NULL,
  notes TEXT,
  status VARCHAR(20) DEFAULT 'submitted' CHECK (status IN ('submitted', 'accepted', 'rejected', 'negotiating')),
  accepted_at TIMESTAMP WITH TIME ZONE,
  m1_transaction_ref VARCHAR(100),
  m2_transaction_ref VARCHAR(100),
  final_transaction_ref VARCHAR(100),
  shipping_courier_name VARCHAR(100),
  shipping_tracking_id VARCHAR(120),
  shipping_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT uq_requirement_manufacturer UNIQUE (requirement_id, manufacturer_id)
);

-- ===========================================
-- INDEXES
-- ===========================================

CREATE INDEX IF NOT EXISTS idx_otp_sessions_phone_number ON otp_sessions(phone_number);
CREATE INDEX IF NOT EXISTS idx_otp_sessions_expires_at ON otp_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_sessions_profile_id ON user_sessions(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON user_sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_buyer_profiles_phone_number ON buyer_profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_buyer_profiles_email ON buyer_profiles(email);
CREATE INDEX IF NOT EXISTS idx_buyer_profiles_buyer_identifier ON buyer_profiles(buyer_identifier);

CREATE INDEX IF NOT EXISTS idx_manufacturer_profiles_phone_number ON manufacturer_profiles(phone_number);
CREATE INDEX IF NOT EXISTS idx_manufacturer_profiles_manufacturer_id ON manufacturer_profiles(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_manufacturer_profiles_business_type ON manufacturer_profiles(business_type);
CREATE INDEX IF NOT EXISTS idx_manufacturer_profiles_is_verified ON manufacturer_profiles(is_verified);
CREATE INDEX IF NOT EXISTS idx_manufacturer_profiles_verified_created ON manufacturer_profiles(is_verified, created_at DESC);

-- Conversations indexes
CREATE INDEX IF NOT EXISTS idx_conversations_buyer_manufacturer ON conversations(buyer_id, manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_buyer_id ON conversations(buyer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_manufacturer_id ON conversations(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message_at ON conversations(last_message_at DESC NULLS LAST);

-- Messages indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read);
CREATE INDEX IF NOT EXISTS idx_messages_requirement_id ON messages(requirement_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender_id ON messages(sender_id);
-- Composite indexes for common query patterns
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created ON messages(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_unread ON messages(conversation_id, is_read, sender_id);

CREATE INDEX IF NOT EXISTS idx_message_attachments_message_id ON message_attachments(message_id);

-- Requirements indexes
CREATE INDEX IF NOT EXISTS idx_requirements_buyer_id ON requirements(buyer_id);
CREATE INDEX IF NOT EXISTS idx_requirements_created_at ON requirements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_requirements_requirement_no ON requirements(requirement_no);
CREATE INDEX IF NOT EXISTS idx_requirements_buyer_created ON requirements(buyer_id, created_at DESC);

-- Requirement responses indexes
CREATE INDEX IF NOT EXISTS idx_requirement_responses_requirement_id ON requirement_responses(requirement_id);
CREATE INDEX IF NOT EXISTS idx_requirement_responses_manufacturer_id ON requirement_responses(manufacturer_id);
CREATE INDEX IF NOT EXISTS idx_requirement_responses_status ON requirement_responses(status);
CREATE INDEX IF NOT EXISTS idx_requirement_responses_created_at ON requirement_responses(created_at DESC);
-- Composite indexes for filtering by manufacturer and status
CREATE INDEX IF NOT EXISTS idx_requirement_responses_manufacturer_status ON requirement_responses(manufacturer_id, status);
CREATE INDEX IF NOT EXISTS idx_requirement_responses_requirement_status ON requirement_responses(requirement_id, status);
CREATE INDEX IF NOT EXISTS idx_requirement_responses_status_manufacturer ON requirement_responses(status, manufacturer_id);

-- ===========================================
-- FUNCTIONS
-- ===========================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM otp_sessions WHERE expires_at < NOW();
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM user_sessions WHERE expires_at < NOW() OR is_active = FALSE;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_manufacturer_id()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
  formatted_id VARCHAR(50);
BEGIN
  IF NEW.manufacturer_id IS NULL THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(manufacturer_id FROM '(\d+)$') AS INTEGER)), 0)
    INTO next_num
    FROM manufacturer_profiles
    WHERE manufacturer_id LIKE 'MANU-%';
    
    next_num := next_num + 1;
    formatted_id := 'MANU-' || LPAD(next_num::TEXT, 4, '0');
    NEW.manufacturer_id := formatted_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_buyer_identifier()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
  formatted_id VARCHAR(50);
BEGIN
  IF NEW.buyer_identifier IS NULL THEN
    SELECT COALESCE(MAX(CAST(SUBSTRING(buyer_identifier FROM '(\d+)$') AS INTEGER)), 0)
    INTO next_num
    FROM buyer_profiles
    WHERE buyer_identifier LIKE 'BUY-%';
    
    next_num := next_num + 1;
    formatted_id := 'BUY-' || LPAD(next_num::TEXT, 4, '0');
    NEW.buyer_identifier := formatted_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Assigns requirement_no as GRUPO-RFQ-NNNN (4-digit suffix).
-- Computes next suffix from the max trailing integer across ALL known historical
-- formats so numbering stays monotonic even if bad rows used GRUPO-REQ-,
-- GROUPO-REQ- (typo), or extra leading zeros (e.g. 000033).
CREATE OR REPLACE FUNCTION generate_requirement_no()
RETURNS TRIGGER AS $$
DECLARE
  next_num INTEGER;
  formatted_no VARCHAR(50);
BEGIN
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(requirement_no FROM '([0-9]+)$') AS INTEGER)
  ), 0)
  INTO next_num
  FROM requirements
  WHERE requirement_no ~ '^(GRUPO|GROUPO)-(RFQ|REQ)-[0-9]+$';

  next_num := next_num + 1;
  formatted_no := 'GRUPO-RFQ-' || LPAD(next_num::TEXT, 4, '0');
  NEW.requirement_no := formatted_no;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.insert_message_and_update_conversation(
  p_conversation_id UUID,
  p_sender_role VARCHAR,
  p_sender_id UUID,
  p_body TEXT,
  p_client_temp_id VARCHAR DEFAULT NULL,
  p_summary_text TEXT DEFAULT NULL,
  p_requirement_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  conversation_id UUID,
  sender_role VARCHAR,
  sender_id UUID,
  body TEXT,
  requirement_id UUID,
  created_at TIMESTAMPTZ,
  is_read BOOLEAN,
  client_temp_id VARCHAR
)
LANGUAGE plpgsql
AS $$
DECLARE
  inserted_message messages%ROWTYPE;
BEGIN
  INSERT INTO public.messages (
    conversation_id,
    sender_role,
    sender_id,
    body,
    client_temp_id,
    requirement_id
  )
  VALUES (
    p_conversation_id,
    p_sender_role,
    p_sender_id,
    p_body,
    p_client_temp_id,
    p_requirement_id
  )
  RETURNING * INTO inserted_message;

  UPDATE public.conversations
  SET
    last_message_at = inserted_message.created_at,
    last_message_text = COALESCE(p_summary_text, inserted_message.body)
  WHERE conversations.id = p_conversation_id;

  RETURN QUERY
  SELECT
    inserted_message.id,
    inserted_message.conversation_id,
    inserted_message.sender_role,
    inserted_message.sender_id,
    inserted_message.body,
    inserted_message.requirement_id,
    inserted_message.created_at,
    inserted_message.is_read,
    inserted_message.client_temp_id;
END;
$$;

-- ===========================================
-- TRIGGERS
-- ===========================================


CREATE TRIGGER update_manufacturer_profiles_updated_at BEFORE UPDATE ON manufacturer_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_requirements_updated_at BEFORE UPDATE ON requirements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_requirement_responses_updated_at BEFORE UPDATE ON requirement_responses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER generate_manufacturer_id_trigger
  BEFORE INSERT ON manufacturer_profiles
  FOR EACH ROW
  WHEN (NEW.manufacturer_id IS NULL)
  EXECUTE FUNCTION generate_manufacturer_id();

CREATE TRIGGER generate_buyer_identifier_trigger
  BEFORE INSERT ON buyer_profiles
  FOR EACH ROW
  WHEN (NEW.buyer_identifier IS NULL)
  EXECUTE FUNCTION generate_buyer_identifier();

CREATE TRIGGER generate_requirement_no_trigger
  BEFORE INSERT ON requirements
  FOR EACH ROW
  WHEN (NEW.requirement_no IS NULL)
  EXECUTE FUNCTION generate_requirement_no();

