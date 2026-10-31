using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;

namespace Bo.Api.Auth;

public static class AuthSetup
{
    public static IServiceCollection AddBoAuth(this IServiceCollection services, IConfiguration config)
    {
        var section = config.GetSection("Auth");
        services.Configure<AuthOptions>(section);
        var options = section.Get<AuthOptions>() ?? new AuthOptions();

        // Refuse to start with a weak key rather than issue forgeable tokens.
        if (Encoding.UTF8.GetByteCount(options.JwtSigningKey) < 32)
            throw new InvalidOperationException("Auth:JwtSigningKey must be at least 32 bytes (Fly secret: Auth__JwtSigningKey).");

        services.AddSingleton<TokenService>();
        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(o =>
            {
                // Keep "sub" as "sub" instead of the long SOAP-era claim name.
                o.MapInboundClaims = false;
                o.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = options.JwtIssuer,
                    ValidAudience = AuthOptions.Audience,
                    IssuerSigningKey = TokenService.KeyFrom(options.JwtSigningKey),
                    ClockSkew = TimeSpan.FromMinutes(2),
                };
            });
        services.AddAuthorization();
        return services;
    }

    /// <summary>The signed-in user's id. Only call behind RequireAuthorization().</summary>
    public static Guid UserId(this ClaimsPrincipal user) =>
        Guid.Parse(user.FindFirstValue("sub") ?? throw new InvalidOperationException("No sub claim on an authorized request."));
}
