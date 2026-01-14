/*
  # Create tables for LUNICAR application

  1. New Tables
    - `demandes`
      - `id` (uuid, primary key)
      - `date` (timestamptz) - Date de la demande
      - `statut` (text) - Statut de la demande (nouvelle, en_cours, traitee)
      - `plaque` (text) - Plaque d'immatriculation
      - `marque` (text) - Marque du véhicule
      - `modele` (text) - Modèle du véhicule
      - `annee` (text) - Année du véhicule
      - `kilometrage` (text) - Kilométrage
      - `carburant` (text) - Type de carburant
      - `boite` (text) - Type de boîte de vitesse
      - `etat_exterieur` (text) - État extérieur du véhicule
      - `etat_interieur` (text) - État intérieur du véhicule
      - `etat_mecanique` (text) - État mécanique
      - `commentaires` (text) - Commentaires du client
      - `delai_vente` (text) - Délai de vente souhaité
      - `civilite` (text) - Civilité du client
      - `nom` (text) - Nom du client
      - `prenom` (text) - Prénom du client
      - `email` (text) - Email du client
      - `telephone` (text) - Téléphone du client
      - `code_postal` (text) - Code postal
      - `photos` (jsonb) - Liste des noms de fichiers photos
      - `created_at` (timestamptz) - Date de création

    - `messages`
      - `id` (uuid, primary key)
      - `date` (timestamptz) - Date du message
      - `lu` (boolean) - Message lu ou non
      - `nom` (text) - Nom de l'expéditeur
      - `email` (text) - Email de l'expéditeur
      - `telephone` (text) - Téléphone (optionnel)
      - `sujet` (text) - Sujet du message
      - `message` (text) - Contenu du message
      - `created_at` (timestamptz) - Date de création

  2. Security
    - Enable RLS on both tables
    - Add policies for public insert (forms)
    - Add policies for authenticated admin read/update
*/

-- Create demandes table
CREATE TABLE IF NOT EXISTS demandes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date timestamptz DEFAULT now(),
  statut text DEFAULT 'nouvelle' NOT NULL,
  plaque text NOT NULL,
  marque text NOT NULL,
  modele text NOT NULL,
  annee text NOT NULL,
  kilometrage text NOT NULL,
  carburant text NOT NULL,
  boite text NOT NULL,
  etat_exterieur text NOT NULL,
  etat_interieur text NOT NULL,
  etat_mecanique text NOT NULL,
  commentaires text DEFAULT '',
  delai_vente text DEFAULT '',
  civilite text NOT NULL,
  nom text NOT NULL,
  prenom text NOT NULL,
  email text NOT NULL,
  telephone text NOT NULL,
  code_postal text NOT NULL,
  photos jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date timestamptz DEFAULT now(),
  lu boolean DEFAULT false,
  nom text NOT NULL,
  email text NOT NULL,
  telephone text DEFAULT '',
  sujet text NOT NULL,
  message text NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE demandes ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Policies for demandes
-- Anyone can insert a demande (public form)
CREATE POLICY "Anyone can insert demande"
  ON demandes
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Authenticated users can view all demandes (admin)
CREATE POLICY "Authenticated users can view demandes"
  ON demandes
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can update demandes (admin)
CREATE POLICY "Authenticated users can update demandes"
  ON demandes
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Policies for messages
-- Anyone can insert a message (public contact form)
CREATE POLICY "Anyone can insert message"
  ON messages
  FOR INSERT
  TO anon
  WITH CHECK (true);

-- Authenticated users can view all messages (admin)
CREATE POLICY "Authenticated users can view messages"
  ON messages
  FOR SELECT
  TO authenticated
  USING (true);

-- Authenticated users can update messages (admin)
CREATE POLICY "Authenticated users can update messages"
  ON messages
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_demandes_date ON demandes(date DESC);
CREATE INDEX IF NOT EXISTS idx_demandes_statut ON demandes(statut);
CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC);
CREATE INDEX IF NOT EXISTS idx_messages_lu ON messages(lu);