CREATE TABLE assignment_source_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL UNIQUE REFERENCES assignments(id),
  original_filename text NOT NULL,
  storage_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type = 'application/pdf'),
  file_size integer NOT NULL CHECK (file_size BETWEEN 1 AND 10485760),
  extracted_text text NOT NULL CHECK (length(trim(extracted_text)) > 0),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);