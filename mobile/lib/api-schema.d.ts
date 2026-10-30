/**
 * STAND-IN for the generated file. Once the API is running, regenerate it from
 * the API's own contract and commit the result:
 *
 *   BO_API_URL=http://localhost:5080 npm run api:types
 *
 * It was hand-written to match api/Bo.Api/Endpoints/*.cs in the shape
 * openapi-typescript emits, so the app builds before the API has ever run.
 * After the first regeneration this comment disappears and the API is the
 * only source of these types.
 */

export interface paths {
  "/auth/google": {
    post: {
      requestBody: { content: { "application/json": components["schemas"]["GoogleSignInRequest"] } };
      responses: {
        200: { content: { "application/json": components["schemas"]["SessionDto"] } };
        401: { content: never };
        403: { content: never };
      };
    };
  };
  "/me": {
    get: {
      responses: {
        200: { content: { "application/json": components["schemas"]["UserDto"] } };
        401: { content: never };
      };
    };
  };
  "/tasks": {
    get: {
      parameters: { query?: { filter?: string } };
      responses: { 200: { content: { "application/json": components["schemas"]["TaskDto"][] } } };
    };
    post: {
      requestBody: { content: { "application/json": components["schemas"]["TaskInput"] } };
      responses: {
        201: { content: { "application/json": components["schemas"]["TaskDto"] } };
        400: { content: { "application/problem+json": components["schemas"]["HttpValidationProblemDetails"] } };
      };
    };
  };
  "/tasks/{id}": {
    get: {
      parameters: { path: { id: string } };
      responses: { 200: { content: { "application/json": components["schemas"]["TaskDto"] } }; 404: { content: never } };
    };
    put: {
      parameters: { path: { id: string } };
      requestBody: { content: { "application/json": components["schemas"]["TaskInput"] } };
      responses: {
        200: { content: { "application/json": components["schemas"]["TaskDto"] } };
        400: { content: { "application/problem+json": components["schemas"]["HttpValidationProblemDetails"] } };
        404: { content: never };
      };
    };
    delete: {
      parameters: { path: { id: string } };
      responses: { 204: { content: never }; 404: { content: never } };
    };
  };
  "/tasks/{id}/complete": {
    post: {
      parameters: { path: { id: string } };
      responses: { 200: { content: { "application/json": components["schemas"]["TaskDto"] } }; 404: { content: never } };
    };
  };
  "/tasks/{id}/reopen": {
    post: {
      parameters: { path: { id: string } };
      responses: { 200: { content: { "application/json": components["schemas"]["TaskDto"] } }; 404: { content: never } };
    };
  };
  "/devices": {
    post: {
      requestBody: { content: { "application/json": components["schemas"]["RegisterDeviceRequest"] } };
      responses: {
        204: { content: never };
        400: { content: { "application/problem+json": components["schemas"]["HttpValidationProblemDetails"] } };
      };
    };
  };
  "/devices/{installationId}": {
    delete: {
      parameters: { path: { installationId: string } };
      responses: { 204: { content: never } };
    };
  };
}

export interface components {
  schemas: {
    GoogleSignInRequest: { idToken: string };
    UserDto: { id: string; email: string; name: string | null };
    SessionDto: { token: string; expiresAt: string; user: components["schemas"]["UserDto"] };
    TaskDto: {
      id: string;
      title: string;
      notes: string | null;
      dueAt: string | null;
      remindAt: string | null;
      doneAt: string | null;
      createdAt: string;
      updatedAt: string;
    };
    TaskInput: { title: string; notes?: string | null; dueAt?: string | null; remindAt?: string | null };
    RegisterDeviceRequest: { installationId: string; expoToken: string; platform: string };
    HttpValidationProblemDetails: { title?: string | null; errors?: Record<string, string[]> };
  };
}
