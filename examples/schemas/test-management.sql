-- Reference schema for the bundled test-management agent. Covers every
-- entity referenced by the example tools (categories, test_cases,
-- test_files, test_runs, users, user_integrations).
--
-- This file is BOTH the schema (DDL) and the seed (DML). The mock instance
-- runs the whole file once on setup() and re-runs the seed portion on
-- every reset(). For ergonomics we keep DDL idempotent with IF NOT EXISTS.

-- gen_random_uuid() is available in Postgres core (13+) — no extension needed.

CREATE TABLE IF NOT EXISTS users (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email        text UNIQUE NOT NULL,
    name         text,
    role         text NOT NULL DEFAULT 'member',
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_integrations (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider     text NOT NULL,
    config       jsonb NOT NULL DEFAULT '{}'::jsonb,
    connected_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS categories (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name         text NOT NULL,
    description  text,
    created_by   uuid REFERENCES users(id),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_cases (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title        text NOT NULL,
    description  text,
    priority     int NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 4),
    status       text NOT NULL DEFAULT 'pending',
    category_id  uuid REFERENCES categories(id),
    created_by   uuid REFERENCES users(id),
    metadata     jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_files (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    app          text NOT NULL,
    path         text NOT NULL,
    description  text,
    uploaded_by  uuid REFERENCES users(id),
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_runs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    test_case_id uuid NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
    status       text NOT NULL,
    device_info  jsonb NOT NULL DEFAULT '{}'::jsonb,
    failures     jsonb NOT NULL DEFAULT '[]'::jsonb,
    executed_by  uuid REFERENCES users(id),
    executed_at  timestamptz NOT NULL DEFAULT now()
);

-- Reset-friendly seed (idempotent because reset() truncates first).
INSERT INTO users (id, email, name, role) VALUES
    ('11111111-1111-1111-1111-111111111111', 'alice@example.com', 'Alice Carter', 'admin'),
    ('22222222-2222-2222-2222-222222222222', 'bob@example.com',   'Bob Chen',     'member'),
    ('33333333-3333-3333-3333-333333333333', 'carol@example.com', 'Carol Diaz',   'member')
ON CONFLICT (email) DO NOTHING;

INSERT INTO user_integrations (user_id, provider, config) VALUES
    ('11111111-1111-1111-1111-111111111111', 'github', '{"repo": "acme/web"}'),
    ('22222222-2222-2222-2222-222222222222', 'jira',   '{"project": "QA"}')
ON CONFLICT DO NOTHING;

INSERT INTO categories (id, name, description, created_by) VALUES
    ('44444444-4444-4444-4444-444444444444', 'Authentication', 'Login, signup, password reset.', '11111111-1111-1111-1111-111111111111'),
    ('55555555-5555-5555-5555-555555555555', 'Billing',        'Pricing, invoices, refunds.',     '11111111-1111-1111-1111-111111111111')
ON CONFLICT DO NOTHING;

INSERT INTO test_cases (id, title, description, priority, status, category_id, created_by) VALUES
    ('66666666-6666-6666-6666-666666666666', 'Login with valid credentials',      'Standard happy path.',                 3, 'active',   '44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222'),
    ('77777777-7777-7777-7777-777777777777', 'Login rejects wrong password',      'Should error with credential mismatch.',3, 'active',   '44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222'),
    ('88888888-8888-8888-8888-888888888888', 'Refund a paid invoice',             'Owner refunds an invoice from billing UI.',2, 'pending', '55555555-5555-5555-5555-555555555555', '33333333-3333-3333-3333-333333333333')
ON CONFLICT DO NOTHING;

INSERT INTO test_files (app, path, description, uploaded_by) VALUES
    ('web',    'tests/auth/login.spec.ts',     'Auth integration tests',      '22222222-2222-2222-2222-222222222222'),
    ('web',    'tests/billing/refund.spec.ts', 'Refund flow integration',     '33333333-3333-3333-3333-333333333333'),
    ('mobile', 'tests/auth/login.spec.ts',     'Mobile login regression',     '22222222-2222-2222-2222-222222222222')
ON CONFLICT DO NOTHING;

INSERT INTO test_runs (test_case_id, status, device_info, failures, executed_by, executed_at) VALUES
    ('66666666-6666-6666-6666-666666666666', 'passed', '{"device":"desktop","os":"macOS","browser":"Chrome 124"}', '[]', '22222222-2222-2222-2222-222222222222', now() - interval '1 day'),
    ('77777777-7777-7777-7777-777777777777', 'failed', '{"device":"desktop","os":"Windows","browser":"Edge 121"}',  '[{"step":3,"message":"Did not see error toast"}]', '22222222-2222-2222-2222-222222222222', now() - interval '2 hours')
ON CONFLICT DO NOTHING;
