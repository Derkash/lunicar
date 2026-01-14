/*
  # Restore SELECT Policies for Server-Side Operations

  1. Security Model
    - INSERT: Public forms can insert with validation
    - SELECT: Server can read data (access controlled by server-side auth)
    - UPDATE/DELETE: Blocked at RLS level (no policies)
    
  2. Security Layers
    - Layer 1: RLS policies control database access
    - Layer 2: Server-side password authentication controls admin features
    - Layer 3: ANON key kept server-side only (never exposed to client)
    
  3. Policy Details
    - Public forms: Can INSERT with required field validation
    - Server admin: Can SELECT for stats/display (auth checked server-side)
    - No UPDATE/DELETE allowed at database level
*/

-- Allow server to SELECT data for admin operations
-- Security is enforced server-side via password authentication
CREATE POLICY "Server can read demandes"
  ON demandes
  FOR SELECT
  TO anon
  USING (true);

CREATE POLICY "Server can read messages"
  ON messages
  FOR SELECT
  TO anon
  USING (true);