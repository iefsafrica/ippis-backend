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

export async function deleteFromBlob(url: string) {
  const token = getToken();
  
  // The URL might be the full public URL, we might need to extract the path or send the full URL depending on the provider.
  // For Vercel Blob API (via fetch), you usually send a DELETE request to the API with the URL as a query param or in the body.
  const response = await fetch(`${BLOB_BASE_URL}/delete`, {
    method: "POST", // Vercel's manual delete API often uses POST /delete with a JSON body
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    const details = await response.text().catch(() => "unknown");
    console.error(`Failed to delete blob ${url}: ${response.status} ${details}`);
  }
  
  return response.ok;
}
