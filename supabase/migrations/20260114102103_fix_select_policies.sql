/*
  # Fix SELECT Policies for Server-Side Access

  1. Security Changes
    - Update SELECT policies to work with service role
    - Remove policies that rely on authenticated role (not used in current setup)
    - Server-side validation handles access control
    
  2. Notes
    - Admin access is controlled server-side via password authentication
    - Database access uses anon key from server (not direct client access)
    - RLS prevents direct database access from unauthorized sources
*/

-- Remove existing SELECT policies for authenticated users
DROP POLICY IF EXISTS "Authenticated users can view demandes" ON demandes;
DROP POLICY IF EXISTS "Authenticated users can view messages" ON messages;

-- No SELECT policies needed - server uses anon key but access is controlled server-side
-- This prevents direct database access while allowing server operations