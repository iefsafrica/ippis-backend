-- THE BELOW SCHEMA IS DONE BY OLUWOLE SAMSON OLAWUMI. 

CREATE TABLE clients (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE project_managers (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE team_members (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    role VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE projects (
    id VARCHAR(20) PRIMARY KEY,  -- e.g. PRJ-001
    name VARCHAR(255) NOT NULL,
    client_id INT NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status ENUM('not-started', 'in-progress', 'completed') DEFAULT 'not-started',
    progress TINYINT UNSIGNED DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    budget DECIMAL(15,2) NOT NULL,
    priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
    manager_id INT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id),
    FOREIGN KEY (manager_id) REFERENCES project_managers(id)
);

CREATE TABLE project_team (
    project_id VARCHAR(20) NOT NULL,
    member_id INT NOT NULL,
    PRIMARY KEY (project_id, member_id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES team_members(id) ON DELETE CASCADE
);

CREATE TABLE milestones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    due_date DATE NOT NULL,
    status ENUM('pending', 'completed') DEFAULT 'pending',
    completed_at TIMESTAMP NULL,
    description TEXT,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE tasks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id VARCHAR(20) NOT NULL,
    milestone_id INT,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    assigned_to INT,
    status ENUM('not-started', 'in-progress', 'completed') DEFAULT 'not-started',
    priority ENUM('low', 'medium', 'high') DEFAULT 'medium',
    due_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_to) REFERENCES team_members(id) ON DELETE SET NULL
);

CREATE TABLE project_notes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id VARCHAR(20) NOT NULL,
    note TEXT NOT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES project_managers(id)
);
