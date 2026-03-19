-- Create sessions table
CREATE TABLE sessions (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    session_id TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    account_number TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE,
    balance DECIMAL(20,8) DEFAULT 0,
    use_testnet BOOLEAN DEFAULT FALSE
);

-- Create trading_sessions table
CREATE TABLE trading_sessions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    initial_investment DECIMAL(20,8) NOT NULL,
    target_profit DECIMAL(20,8) NOT NULL,
    time_limit DECIMAL(5,2) NOT NULL,
    risk_level TEXT NOT NULL,
    trading_pairs JSONB NOT NULL,
    started_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_running BOOLEAN DEFAULT TRUE,
    current_profit DECIMAL(20,8) DEFAULT 0,
    trades JSONB DEFAULT '[]'::jsonb,
    last_trade_time BIGINT,
    target_reached BOOLEAN DEFAULT FALSE,
    time_exceeded BOOLEAN DEFAULT FALSE,
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Create trades table
CREATE TABLE trades (
    id BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    session_id TEXT NOT NULL,
    bot_id TEXT NOT NULL,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    quantity DECIMAL(20,8) NOT NULL,
    price DECIMAL(20,8) NOT NULL,
    profit DECIMAL(20,8) NOT NULL,
    size TEXT,
    confidence TEXT,
    win_streak INTEGER DEFAULT 0,
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

-- Create indexes for better performance
CREATE INDEX idx_trades_session_id ON trades(session_id);
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trading_sessions_session_id ON trading_sessions(session_id);
CREATE INDEX idx_sessions_email ON sessions(email);
