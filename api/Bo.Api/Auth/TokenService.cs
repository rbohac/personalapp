using System.Security.Claims;
using System.Text;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Bo.Api.Auth;

/// <summary>
/// Issues Bo's own access token after Google has vouched for who you are.
/// The phone never sends a Google token again after sign-in — it holds this
/// one in SecureStore and presents it as a bearer token.
/// </summary>
public sealed class TokenService(IOptions<AuthOptions> options)
{
    private readonly AuthOptions _o = options.Value;

    public static SymmetricSecurityKey KeyFrom(string secret) => new(Encoding.UTF8.GetBytes(secret));

    public (string Token, DateTime ExpiresAt) Issue(Guid userId, string email)
    {
        var expires = DateTime.UtcNow.AddDays(_o.TokenLifetimeDays);
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = _o.JwtIssuer,
            Audience = AuthOptions.Audience,
            Expires = expires,
            Subject = new ClaimsIdentity([new Claim("sub", userId.ToString()), new Claim("email", email)]),
            SigningCredentials = new SigningCredentials(KeyFrom(_o.JwtSigningKey), SecurityAlgorithms.HmacSha256),
        });
        return (token, expires);
    }
}
