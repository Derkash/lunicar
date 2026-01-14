/*
  # Fix RLS Security Policies

  1. Security Changes
    - Remove overly permissive UPDATE policies
    - Keep INSERT policies for public forms (necessary for functionality)
    - Keep SELECT policies for authenticated admin access
    - Add basic validation to INSERT policies
    
  2. Notes
    - INSERT policies must allow public access for form submissions
    - Admin updates will be handled server-side with service role
    - Indexes kept for future query optimization
*/

-- Drop existing overly permissive UPDATE policies
DROP POLICY IF EXISTS "Authenticated users can update demandes" ON demandes;
DROP POLICY IF EXISTS "Authenticated users can update messages" ON messages;

-- Recreate INSERT policies with basic validation
DROP POLICY IF EXISTS "Anyone can insert demande" ON demandes;
CREATE POLICY "Anyone can insert demande"
  ON demandes
  FOR INSERT
  TO anon
  WITH CHECK (
    plaque IS NOT NULL AND plaque != '' AND
    marque IS NOT NULL AND marque != '' AND
    modele IS NOT NULL AND modele != '' AND
    email IS NOT NULL AND email != '' AND
    nom IS NOT NULL AND nom != '' AND
    prenom IS NOT NULL AND prenom != ''
  );

DROP POLICY IF EXISTS "Anyone can insert message" ON messages;
CREATE POLICY "Anyone can insert message"
  ON messages
  FOR INSERT
  TO anon
  WITH CHECK (
    nom IS NOT NULL AND nom != '' AND
    email IS NOT NULL AND email != '' AND
    sujet IS NOT NULL AND sujet != '' AND
    message IS NOT NULL AND message != ''
  );

-- Keep SELECT policies for authenticated users (admin access)
-- These are already correctly restrictive