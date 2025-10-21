CREATE TABLE Termination (
    id VARCHAR(20) PRIMARY KEY,
    employeeId VARCHAR(20) NOT NULL,
    employeeName VARCHAR(100) NOT NULL,
    employeeAvatar VARCHAR(255),
    department VARCHAR(100),
    position VARCHAR(100),
    terminationType VARCHAR(50),
    reason TEXT,
    noticeDate DATETIME,
    terminationDate DATETIME,
    status VARCHAR(50),
    initiatedBy VARCHAR(100),
    initiatedById VARCHAR(20),
    approvedBy VARCHAR(100),
    approvedById VARCHAR(20),
    approvalDate DATETIME,
    exitInterviewDate DATETIME,
    exitInterviewConductedBy VARCHAR(100),
    exitInterviewConductedById VARCHAR(20)
);

CREATE TABLE TerminationDocuments (
    id VARCHAR(20) PRIMARY KEY,
    terminationId VARCHAR(20) NOT NULL,
    name VARCHAR(255),
    url VARCHAR(255),
    FOREIGN KEY (terminationId) REFERENCES Termination(id)
);