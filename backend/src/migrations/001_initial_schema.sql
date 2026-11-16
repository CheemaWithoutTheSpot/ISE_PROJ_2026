CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (length(trim(full_name)) BETWEEN 1 AND 120),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('teacher', 'student')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE classrooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  subject text NOT NULL DEFAULT '',
  grade_level text NOT NULL DEFAULT '',
  joining_code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX classrooms_teacher_idx ON classrooms(teacher_id, created_at DESC);

CREATE TABLE classroom_memberships (
  classroom_id uuid NOT NULL REFERENCES classrooms(id),
  student_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (classroom_id, student_id)
);
CREATE INDEX classroom_memberships_student_idx ON classroom_memberships(student_id, joined_at DESC);

CREATE TABLE rubric_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rubric_template_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES rubric_templates(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  max_marks numeric(8,2) NOT NULL CHECK (max_marks >= 0),
  UNIQUE (template_id, position)
);

CREATE TABLE assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  classroom_id uuid NOT NULL REFERENCES classrooms(id),
  teacher_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 180),
  instructions text NOT NULL DEFAULT '',
  due_at timestamptz NOT NULL,
  rubric_locked boolean NOT NULL DEFAULT false,
  released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assignments_classroom_due_idx ON assignments(classroom_id, due_at);

CREATE TABLE assignment_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id),
  position integer NOT NULL CHECK (position >= 0),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '',
  max_marks numeric(8,2) NOT NULL CHECK (max_marks >= 0),
  UNIQUE (assignment_id, position)
);

CREATE TABLE submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id),
  student_id uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL CHECK (version > 0),
  original_filename text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL,
  file_size integer NOT NULL CHECK (file_size BETWEEN 1 AND 10485760),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id, version)
);
CREATE INDEX submissions_assignment_idx ON submissions(assignment_id, submitted_at DESC);

CREATE TABLE processing_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL REFERENCES submissions(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'manual', 'failed', 'obsolete')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  locked_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX processing_jobs_active_unique ON processing_jobs(submission_id) WHERE status IN ('pending', 'processing');
CREATE INDEX processing_jobs_claim_idx ON processing_jobs(status, created_at) WHERE status IN ('pending', 'processing');

CREATE TABLE evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_id uuid NOT NULL UNIQUE REFERENCES submissions(id),
  status text NOT NULL CHECK (status IN ('completed', 'manual')),
  provider text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE evaluation_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id),
  assignment_criterion_id uuid NOT NULL REFERENCES assignment_criteria(id),
  suggested_marks numeric(8,2) NOT NULL CHECK (suggested_marks >= 0),
  explanation text NOT NULL DEFAULT '',
  UNIQUE (evaluation_id, assignment_criterion_id)
);

CREATE TABLE final_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES assignments(id),
  student_id uuid NOT NULL REFERENCES users(id),
  total_marks numeric(8,2) NOT NULL CHECK (total_marks >= 0),
  max_marks numeric(8,2) NOT NULL CHECK (max_marks >= 0),
  submission_status text NOT NULL CHECK (submission_status IN ('submitted', 'not_submitted')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, student_id)
);

CREATE TABLE final_result_criteria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  final_result_id uuid NOT NULL REFERENCES final_results(id),
  assignment_criterion_id uuid NOT NULL REFERENCES assignment_criteria(id),
  marks numeric(8,2) NOT NULL CHECK (marks >= 0),
  UNIQUE (final_result_id, assignment_criterion_id)
);