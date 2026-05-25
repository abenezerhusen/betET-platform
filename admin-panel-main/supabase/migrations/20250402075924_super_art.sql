/*
  # Betting System Initial Schema

  1. User Management
    - `agents` - Regional managers overseeing multiple branches
    - `branches` - Physical betting shops
    - `sales_staff` - Cashiers/staff at branches
    - `online_users` - Direct platform users
    - `admin_users` - System administrators

  2. Transaction Management
    - `transactions` - All financial transactions
    - `wallets` - User/Agent/Branch wallet balances
    - `payment_methods` - Available payment options

  3. Betting Management
    - `bets` - All betting records
    - `bet_types` - Different types of bets
    - `bet_status` - Status tracking for bets
    - `games` - Available games/matches

  4. Casino & Virtual Games
    - `casino_games` - Available casino games
    - `casino_transactions` - Casino-specific transactions
    - `virtual_games` - Virtual game offerings
    - `game_results` - Game outcomes and results
*/

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- User Management Tables
CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  commission_rate decimal(5,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid REFERENCES agents(id),
  name text NOT NULL,
  address text NOT NULL,
  city text NOT NULL,
  region text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'active',
  min_bet_amount decimal(10,2) NOT NULL DEFAULT 0,
  max_bet_amount decimal(10,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sales_staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid REFERENCES branches(id),
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS online_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid UNIQUE, -- Reference to auth.users
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text UNIQUE NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'active',
  kyc_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id uuid UNIQUE, -- Reference to auth.users
  first_name text NOT NULL,
  last_name text NOT NULL,
  email text UNIQUE NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Transaction Management Tables
CREATE TABLE IF NOT EXISTS wallets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  owner_type text NOT NULL, -- 'agent', 'branch', 'online_user'
  balance decimal(15,2) NOT NULL DEFAULT 0,
  locked_amount decimal(15,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL, -- 'cash', 'bank_transfer', 'mobile_money', etc.
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id uuid REFERENCES wallets(id),
  payment_method_id uuid REFERENCES payment_methods(id),
  type text NOT NULL, -- 'deposit', 'withdrawal', 'bet', 'win', 'commission'
  amount decimal(15,2) NOT NULL,
  fee decimal(10,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  reference_id text,
  metadata jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Betting Management Tables
CREATE TABLE IF NOT EXISTS games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL, -- 'sports', 'casino', 'virtual'
  status text NOT NULL DEFAULT 'active',
  start_time timestamptz,
  end_time timestamptz,
  result jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bet_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  min_selections int NOT NULL DEFAULT 1,
  max_selections int,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  user_type text NOT NULL, -- 'online_user', 'branch_user'
  branch_id uuid REFERENCES branches(id),
  sales_staff_id uuid REFERENCES sales_staff(id),
  bet_type_id uuid REFERENCES bet_types(id),
  stake_amount decimal(15,2) NOT NULL,
  potential_win_amount decimal(15,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  settled_amount decimal(15,2),
  selections jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Casino & Virtual Games Tables
CREATE TABLE IF NOT EXISTS casino_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider text NOT NULL,
  type text NOT NULL, -- 'slots', 'table', 'live'
  min_bet decimal(10,2) NOT NULL,
  max_bet decimal(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS virtual_games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  provider text NOT NULL,
  type text NOT NULL,
  frequency interval NOT NULL, -- How often the game runs
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS game_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL,
  game_type text NOT NULL, -- 'casino', 'virtual'
  result jsonb NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE online_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE bet_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE bets ENABLE ROW LEVEL SECURITY;
ALTER TABLE casino_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE virtual_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_results ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Admins can manage agents"
  ON agents
  TO authenticated
  USING (auth.uid() IN (SELECT auth_id FROM admin_users WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT auth_id FROM admin_users WHERE role = 'admin'));

CREATE POLICY "Agents can view their own data"
  ON agents
  FOR SELECT
  TO authenticated
  USING (id = auth.uid());

CREATE POLICY "Admins can manage branches"
  ON branches
  TO authenticated
  USING (auth.uid() IN (SELECT auth_id FROM admin_users WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT auth_id FROM admin_users WHERE role = 'admin'));

CREATE POLICY "Agents can view their branches"
  ON branches
  FOR SELECT
  TO authenticated
  USING (agent_id = auth.uid());

CREATE POLICY "Admins can manage sales staff"
  ON sales_staff
  TO authenticated
  USING (auth.uid() IN (SELECT auth_id FROM admin_users WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT auth_id FROM admin_users WHERE role = 'admin'));

CREATE POLICY "Users can view their own data"
  ON online_users
  FOR SELECT
  TO authenticated
  USING (auth_id = auth.uid());

CREATE POLICY "Users can view their own wallet"
  ON wallets
  FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "Users can view their own transactions"
  ON transactions
  FOR SELECT
  TO authenticated
  USING (wallet_id IN (SELECT id FROM wallets WHERE owner_id = auth.uid()));

CREATE POLICY "Users can view active games"
  ON games
  FOR SELECT
  TO authenticated
  USING (status = 'active');

CREATE POLICY "Users can view their own bets"
  ON bets
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Create indexes for better performance
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_branches_agent_id ON branches(agent_id);
CREATE INDEX idx_branches_status ON branches(status);
CREATE INDEX idx_sales_staff_branch_id ON sales_staff(branch_id);
CREATE INDEX idx_online_users_status ON online_users(status);
CREATE INDEX idx_wallets_owner ON wallets(owner_id, owner_type);
CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_bets_user ON bets(user_id, user_type);
CREATE INDEX idx_bets_status ON bets(status);
CREATE INDEX idx_games_status ON games(status);
CREATE INDEX idx_casino_games_status ON casino_games(status);
CREATE INDEX idx_virtual_games_status ON virtual_games(status);

-- Create functions for common operations
CREATE OR REPLACE FUNCTION update_wallet_balance(
  p_wallet_id uuid,
  p_amount decimal,
  p_type text
) RETURNS void AS $$
BEGIN
  IF p_type = 'credit' THEN
    UPDATE wallets
    SET balance = balance + p_amount,
        updated_at = now()
    WHERE id = p_wallet_id;
  ELSIF p_type = 'debit' THEN
    UPDATE wallets
    SET balance = balance - p_amount,
        updated_at = now()
    WHERE id = p_wallet_id
    AND balance >= p_amount;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Create function to place a bet
CREATE OR REPLACE FUNCTION place_bet(
  p_user_id uuid,
  p_user_type text,
  p_branch_id uuid,
  p_sales_staff_id uuid,
  p_bet_type_id uuid,
  p_stake_amount decimal,
  p_potential_win_amount decimal,
  p_selections jsonb
) RETURNS uuid AS $$
DECLARE
  v_bet_id uuid;
  v_wallet_id uuid;
BEGIN
  -- Get wallet ID
  SELECT id INTO v_wallet_id
  FROM wallets
  WHERE owner_id = p_user_id
  AND owner_type = p_user_type;

  -- Check sufficient balance
  IF NOT EXISTS (
    SELECT 1 FROM wallets
    WHERE id = v_wallet_id
    AND balance >= p_stake_amount
  ) THEN
    RAISE EXCEPTION 'Insufficient balance';
  END IF;

  -- Create bet
  INSERT INTO bets (
    user_id,
    user_type,
    branch_id,
    sales_staff_id,
    bet_type_id,
    stake_amount,
    potential_win_amount,
    selections
  ) VALUES (
    p_user_id,
    p_user_type,
    p_branch_id,
    p_sales_staff_id,
    p_bet_type_id,
    p_stake_amount,
    p_potential_win_amount,
    p_selections
  ) RETURNING id INTO v_bet_id;

  -- Deduct stake amount from wallet
  PERFORM update_wallet_balance(v_wallet_id, p_stake_amount, 'debit');

  RETURN v_bet_id;
END;
$$ LANGUAGE plpgsql;