export interface SchemaTemplate {
  id: string;
  marker: string;
  name: string;
  description: string;
  ddlSql: string;
  seedSql: string;
}

export const TEMPLATE_LIBRARY: SchemaTemplate[] = [
  {
    id: 'test-management',
    marker: 'A.1  Test management',
    name: 'Test management baseline',
    description:
      'Users, categories, test files, test cases, test runs, and integrations — the bundled example.',
    ddlSql: `CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  role text DEFAULT 'engineer',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text,
  metadata jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  app text NOT NULL,
  filename text NOT NULL,
  content_hash text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  test_file_id uuid REFERENCES test_files(id),
  title text NOT NULL,
  description text,
  status text DEFAULT 'draft',
  priority text DEFAULT 'medium',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS test_case_categories (
  test_case_id uuid REFERENCES test_cases(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (test_case_id, category_id)
);

CREATE TABLE IF NOT EXISTS test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  test_case_id uuid REFERENCES test_cases(id),
  user_id uuid REFERENCES users(id),
  device text,
  status text DEFAULT 'pending',
  started_at timestamptz DEFAULT now(),
  finished_at timestamptz,
  error text
);
`,
    seedSql: `INSERT INTO users (id, email, name, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'amelia@checkpoint.dev', 'Amelia Park', 'engineer'),
  ('22222222-2222-2222-2222-222222222222', 'jordan@checkpoint.dev', 'Jordan Reyes', 'qa'),
  ('33333333-3333-3333-3333-333333333333', 'sasha@checkpoint.dev', 'Sasha Brown', 'manager');

INSERT INTO categories (id, name, description) VALUES
  ('aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Auth', 'Authentication flows'),
  ('aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Billing', 'Billing and invoices'),
  ('aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Onboarding', 'Onboarding journeys');

INSERT INTO test_files (id, user_id, app, filename) VALUES
  ('bbbb1111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'web', 'auth.spec.ts'),
  ('bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'web', 'billing.spec.ts'),
  ('bbbb3333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'mobile', 'onboarding.spec.ts');

INSERT INTO test_cases (id, user_id, test_file_id, title, status, priority) VALUES
  ('cccc1111-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'bbbb1111-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Sign up with email', 'active', 'high'),
  ('cccc2222-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'bbbb2222-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Refund within 30-day window', 'active', 'medium'),
  ('cccc3333-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'bbbb3333-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'First-run welcome screen', 'draft', 'low');

INSERT INTO test_case_categories VALUES
  ('cccc1111-cccc-cccc-cccc-cccccccccccc', 'aaaa1111-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('cccc2222-cccc-cccc-cccc-cccccccccccc', 'aaaa2222-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
  ('cccc3333-cccc-cccc-cccc-cccccccccccc', 'aaaa3333-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

INSERT INTO test_runs (test_case_id, user_id, device, status, error) VALUES
  ('cccc1111-cccc-cccc-cccc-cccccccccccc', '11111111-1111-1111-1111-111111111111', 'iphone-15', 'passed', NULL),
  ('cccc2222-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'pixel-8', 'failed', 'Timeout on confirmation page'),
  ('cccc3333-cccc-cccc-cccc-cccccccccccc', '33333333-3333-3333-3333-333333333333', 'web-chrome', 'pending', NULL);
`
  },
  {
    id: 'support-bot',
    marker: 'A.2  Support bot',
    name: 'Customer support agent',
    description: 'Customers, orders, refunds, tickets — for testing support agents.',
    ddlSql: `CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text UNIQUE NOT NULL,
  name text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id),
  total_cents integer NOT NULL,
  status text DEFAULT 'paid',
  placed_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid REFERENCES orders(id),
  amount_cents integer NOT NULL,
  reason text,
  issued_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES customers(id),
  subject text NOT NULL,
  status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);
`,
    seedSql: `INSERT INTO customers (id, email, name) VALUES
  ('10000000-0000-0000-0000-000000000001', 'kim@example.com', 'Kim Park'),
  ('10000000-0000-0000-0000-000000000002', 'maria@example.com', 'Maria Lopez');

INSERT INTO orders (id, customer_id, total_cents, status, placed_at) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 4999, 'paid', now() - interval '5 days'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 12999, 'paid', now() - interval '60 days');

INSERT INTO tickets (customer_id, subject, status) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Where is my order?', 'open');
`
  },
  {
    id: 'crm',
    marker: 'A.3  CRM',
    name: 'Workspace CRM',
    description: 'Contacts, companies, deals, activities — for testing CRM agents.',
    ddlSql: `CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  domain text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id),
  email text UNIQUE NOT NULL,
  name text,
  title text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid REFERENCES companies(id),
  amount_cents integer,
  stage text DEFAULT 'prospect',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id uuid REFERENCES contacts(id),
  type text NOT NULL,
  notes text,
  occurred_at timestamptz DEFAULT now()
);
`,
    seedSql: `INSERT INTO companies (id, name, domain) VALUES
  ('30000000-0000-0000-0000-000000000001', 'Atlas Robotics', 'atlas.dev'),
  ('30000000-0000-0000-0000-000000000002', 'Pico Health', 'pico.health');

INSERT INTO contacts (company_id, email, name, title) VALUES
  ('30000000-0000-0000-0000-000000000001', 'sam@atlas.dev', 'Sam Vega', 'CTO'),
  ('30000000-0000-0000-0000-000000000002', 'mei@pico.health', 'Mei Tanaka', 'Director of AI');
`
  }
];
