export type RegisterResponse = {
  success: boolean;
  message: string;
  error?: string;
  [key: string]: unknown;
};

export type RegisterStepContext<TBody> = {
  endpoint: string;
  registrationId: string;
  payload: TBody;
  response: RegisterResponse;
  status: number;
};

export type RegisterStepOptions<TBody> = {
  method?: "POST" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  onFailure?: (context: RegisterStepContext<TBody>) => void;
  onSuccess?: (context: RegisterStepContext<TBody>) => void;
};

export async function registerStep<TBody extends Record<string, unknown>>(
  endpoint: string,
  body: TBody,
  registrationId: string,
  options?: RegisterStepOptions<TBody>
): Promise<RegisterResponse> {
  const payload = {
    ...body,
    registration_id: registrationId,
  };

  const { method = "POST", headers, onFailure, onSuccess } = options ?? {};

  const response = await fetch(endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(payload),
  });

  const data: RegisterResponse = await response.json().catch((_) => ({
    success: false,
    message: "Unexpected response format",
  }));

  const context: RegisterStepContext<TBody> = {
    endpoint,
    registrationId,
    payload,
    response: data,
    status: response.status,
  };

  if (!data.success) {
    console.error("Registration step failed", context);
    onFailure?.(context);
  } else {
    onSuccess?.(context);
  }

  return data;
}
