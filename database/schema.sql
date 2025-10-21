-- Main registrations table to track overall registration status
CREATE TABLE registrations (
    id SERIAL PRIMARY KEY,
    registration_id VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'draft', -- draft, pending_approval, approved, rejected, incomplete
    current_step VARCHAR(20) NOT NULL DEFAULT 'verification', -- verification, personal_info, employment_info, documents, review, submitted
    declaration BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    submitted_at TIMESTAMP,
    approved_at TIMESTAMP,
    rejected_at TIMESTAMP
);

-- Step 1: Verification data
CREATE TABLE verification_data (
    id SERIAL PRIMARY KEY,
    registration_id VARCHAR(50) UNIQUE NOT NULL,
    bvn VARCHAR(11) NOT NULL,
    bvn_verified BOOLEAN NOT NULL DEFAULT FALSE,
    nin VARCHAR(11) NOT NULL,
    nin_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_date TIMESTAMP,
    FOREIGN KEY (registration_id) REFERENCES registrations(registration_id) ON DELETE CASCADE
);

-- Step 2: Personal Information
CREATE TABLE personal_info (
    id SERIAL PRIMARY KEY,
    registration_id VARCHAR(50) UNIQUE NOT NULL,
    title VARCHAR(10) NOT NULL,
    surname VARCHAR(100) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    other_names VARCHAR(100),
    phone_number VARCHAR(20) NOT NULL,
    email VARCHAR(100) NOT NULL,
    date_of_birth DATE NOT NULL,
    sex VARCHAR(10) NOT NULL,
    marital_status VARCHAR(20) NOT NULL,
    state_of_origin VARCHAR(50) NOT NULL,
    lga VARCHAR(100) NOT NULL,
    state_of_residence VARCHAR(50) NOT NULL,
    address_state_of_residence TEXT NOT NULL,
    next_of_kin_name VARCHAR(200) NOT NULL,
    next_of_kin_relationship VARCHAR(50) NOT NULL,
    next_of_kin_phone_number VARCHAR(20) NOT NULL,
    next_of_kin_address TEXT NOT NULL,
    FOREIGN KEY (registration_id) REFERENCES registrations(registration_id) ON DELETE CASCADE
);

-- Step 3: Employment Information
CREATE TABLE employment_info (
    id SERIAL PRIMARY KEY,
    registration_id VARCHAR(50) UNIQUE NOT NULL,
    employment_id_no VARCHAR(50) NOT NULL,
    service_no VARCHAR(50) NOT NULL,
    file_no VARCHAR(50) NOT NULL,
    rank_position VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL,
    organization VARCHAR(200) NOT NULL,
    employment_type VARCHAR(50) NOT NULL,
    probation_period VARCHAR(20) NOT NULL,
    work_location VARCHAR(100) NOT NULL,
    date_of_first_appointment DATE NOT NULL,
    gl VARCHAR(10) NOT NULL,
    step VARCHAR(10) NOT NULL,
    salary_structure VARCHAR(20) NOT NULL,
    cadre VARCHAR(50) NOT NULL,
    name_of_bank VARCHAR(100) NOT NULL,
    account_number VARCHAR(20) NOT NULL,
    pfa_name VARCHAR(100) NOT NULL,
    rsapin VARCHAR(50) NOT NULL,
    educational_background TEXT,
    certifications TEXT,
    FOREIGN KEY (registration_id) REFERENCES registrations(registration_id) ON DELETE CASCADE
);

-- Step 4: Document Upload
CREATE TABLE document_uploads (
    id SERIAL PRIMARY KEY,
    registration_id VARCHAR(50) UNIQUE NOT NULL,
    appointment_letter_path VARCHAR(255) NOT NULL,
    educational_certificates_path VARCHAR(255) NOT NULL,
    promotion_letter_path VARCHAR(255),
    other_documents_path VARCHAR(255),
    profile_image_path VARCHAR(255) NOT NULL,
    signature_path VARCHAR(255) NOT NULL,
    upload_date TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (registration_id) REFERENCES registrations(registration_id) ON DELETE CASCADE
);

-- Table for admin comments on registrations
CREATE TABLE registration_comments (
    id SERIAL PRIMARY KEY,
    registration_id VARCHAR(50) NOT NULL,
    comment_text TEXT NOT NULL,
    author VARCHAR(100),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (registration_id) REFERENCES registrations(registration_id) ON DELETE CASCADE
);

-- Table for tracking registration history/audit trail
CREATE TABLE registration_history (
    id SERIAL PRIMARY KEY,
    registration_id VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    details TEXT,
    performed_by VARCHAR(100),
    performed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (registration_id) REFERENCES registrations(registration_id) ON DELETE CASCADE
);
