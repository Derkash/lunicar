-- LUNICAR : espace admin (demandes, messages, réglages) + photos par dossier.
-- À exécuter une fois dans Supabase > SQL Editor. Rejouable sans risque.

create table if not exists demandes (
    ref            text primary key,              -- 8 premiers caractères de l'id, en majuscules
    id             text not null,
    created_at     timestamptz not null default now(),
    updated_at     timestamptz not null default now(),
    type           text not null default 'estimation',   -- estimation | rappel
    origine        text not null default 'site',          -- site | abandon | gmail | journal
    statut         text not null default 'nouvelle',
    dossier        text not null,                         -- dossier des photos dans le bucket
    data           jsonb not null default '{}'::jsonb,    -- tout ce que le vendeur a saisi (+ fiche API)
    estimation     jsonb,
    estimation_at  timestamptz,
    suivi          jsonb not null default '{}'::jsonb,    -- notes, offre faite, prix d'achat, historique
    photos         jsonb not null default '[]'::jsonb
);
create index if not exists demandes_created_idx on demandes (created_at desc);
create index if not exists demandes_statut_idx on demandes (statut);

create table if not exists messages (
    id          text primary key,
    created_at  timestamptz not null default now(),
    lu          boolean not null default false,
    data        jsonb not null default '{}'::jsonb
);

create table if not exists reglages (
    cle    text primary key,
    valeur jsonb not null
);

-- Accès uniquement par la clé service_role (serveur). Aucun accès public.
alter table demandes enable row level security;
alter table messages enable row level security;
alter table reglages enable row level security;

-- Bucket privé des photos : un dossier par demande.
insert into storage.buckets (id, name, public)
values ('demandes', 'demandes', false)
on conflict (id) do nothing;
