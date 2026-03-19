const BLOB_BASE_URL = "https://blob.vercel-storage.com";

function getToken() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }
  return token;
}

export async function uploadToBlob(file: File, fileName: string) {
  const token = getToken();
  const response = await fetch(`${BLOB_BASE_URL}/${fileName}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "unknown");
    throw new Error(
      `Failed to upload ${fileName}: ${response.status} ${details}`
    );
  }

  return `${BLOB_BASE_URL}/${fileName}`;
}
