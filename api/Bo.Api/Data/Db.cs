using Dapper;
using Npgsql;

namespace Bo.Api.Data;

/// <summary>
/// The one place a database connection is made. Neon hands out
/// <c>postgresql://user:pass@host/db?sslmode=require</c> URLs, while Npgsql
/// wants <c>Host=…;Username=…</c> — so either form is accepted and normalized
/// here, and nothing else in the app has to care which one was pasted.
/// </summary>
public sealed class Db(string connectionString)
{
    private readonly NpgsqlDataSource _source = NpgsqlDataSource.Create(connectionString);

    public string ConnectionString { get; } = connectionString;

    public ValueTask<NpgsqlConnection> OpenAsync(CancellationToken ct = default) => _source.OpenConnectionAsync(ct);

    public static string Normalize(string raw)
    {
        if (!raw.StartsWith("postgres://") && !raw.StartsWith("postgresql://")) return raw;

        var uri = new Uri(raw);
        var userInfo = uri.UserInfo.Split(':', 2);
        var b = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.IsDefaultPort || uri.Port <= 0 ? 5432 : uri.Port,
            Database = uri.AbsolutePath.TrimStart('/'),
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
        };

        // Carry query options across (sslmode=require is the one that matters
        // for Neon). channel_binding is libpq-only, so it is dropped.
        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = pair.Split('=', 2);
            var key = Uri.UnescapeDataString(kv[0]);
            var value = kv.Length > 1 ? Uri.UnescapeDataString(kv[1]) : "";
            if (key.Equals("sslmode", StringComparison.OrdinalIgnoreCase))
                b.SslMode = Enum.Parse<SslMode>(value.Replace("-", ""), ignoreCase: true);
        }
        return b.ConnectionString;
    }
}

public static class DbSetup
{
    public static IServiceCollection AddBoDatabase(this IServiceCollection services, IConfiguration config)
    {
        var raw = config.GetConnectionString("Bo")
            ?? throw new InvalidOperationException("ConnectionStrings:Bo is not set (Fly secret: ConnectionStrings__Bo).");

        // Columns are snake_case, C# properties are PascalCase.
        DefaultTypeMap.MatchNamesWithUnderscores = true;

        services.AddSingleton(new Db(Db.Normalize(raw)));
        return services;
    }
}
