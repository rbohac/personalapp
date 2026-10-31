namespace Bo.Api.Auth;

public sealed class AuthOptions
{
    /// <summary>Only these Google accounts may sign in. One today.</summary>
    public string[] AllowedEmails { get; set; } = [];

    /// <summary>
    /// The OAuth client ids whose Google ID tokens are accepted — the iOS
    /// client (and later Android/web). A token minted for any other app is
    /// refused even if it belongs to an allowed email.
    /// </summary>
    public string[] GoogleClientIds { get; set; } = [];

    /// <summary>HMAC key for Bo's own access tokens. At least 32 bytes; a Fly secret.</summary>
    public string JwtSigningKey { get; set; } = "";

    public string JwtIssuer { get; set; } = "https://api.bohac.dev";

    public int TokenLifetimeDays { get; set; } = 60;

    public const string Audience = "bo-app";
}
