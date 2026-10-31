# Built from the repository root (`docker build -f api/Dockerfile .`), so the
# image can carry areas/ — the API reads it at startup.

# Build: the SDK image compiles and publishes; only the output is kept.
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY api/Bo.Api/Bo.Api.csproj Bo.Api/
RUN dotnet restore Bo.Api/Bo.Api.csproj
COPY api/Bo.Api/ Bo.Api/
RUN dotnet publish Bo.Api/Bo.Api.csproj -c Release -o /app --no-restore

# Run: the much smaller ASP.NET runtime image, as a non-root user.
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
COPY areas/ areas/
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Bo.Api.dll"]
