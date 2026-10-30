#!/bin/bash
# Setup script for the "Bo + Spearfish" Claude cloud environment.
# Paste into: environment settings → Setup script. Runs as root on Ubuntu 24.04
# before each new session; the result is cached (~7 days) when it finishes in
# under ~5 minutes, so later sessions start with all of this already on disk.
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive

# .NET 10 SDK — from Ubuntu's own archive, which the sandbox can always reach.
( apt-get update -qq && apt-get install -y -qq dotnet-sdk-10.0 ) &

# Expo's build/submit/update CLI, so sessions can run `eas` for Bo's iOS app.
( npm install -g --silent eas-cli ) &

wait

# Docker: start the daemon, pre-pull the images Bo uses, then stop it. The
# pulled images land in the cached snapshot; sessions start dockerd themselves.
if ! docker info >/dev/null 2>&1; then
  (dockerd >/var/log/dockerd-setup.log 2>&1 &)
  for i in $(seq 1 30); do docker info >/dev/null 2>&1 && break; sleep 1; done
fi
docker pull -q mcr.microsoft.com/dotnet/sdk:10.0 &
docker pull -q mcr.microsoft.com/dotnet/aspnet:10.0 &
docker pull -q postgres:17 &
wait
pkill dockerd || true

# docker-build-sandbox: `docker build` that trusts the session's network proxy.
cat > /usr/local/bin/docker-build-sandbox <<'HELPER'
#!/bin/bash
# Build a Docker image inside a Claude cloud session. Cloud sessions send HTTPS
# through a proxy whose CA the build containers don't trust, so this builds a
# throwaway copy of the Dockerfile that trusts that CA after every FROM. The
# real Dockerfile is never modified; images built here are for testing only.
# Usage: docker-build-sandbox [-f Dockerfile] [docker build args...] <context>
set -euo pipefail
CA=/root/.ccr/ca-bundle.crt
args=("$@"); dockerfile=""; out=()
for ((i=0; i<${#args[@]}; i++)); do
  if [[ ${args[i]} == "-f" || ${args[i]} == "--file" ]]; then dockerfile=${args[i+1]}; i=$((i+1))
  else out+=("${args[i]}"); fi
done
ctx=${out[-1]}; dockerfile=${dockerfile:-$ctx/Dockerfile}
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
cp "$CA" "$tmp/sandbox-ca.crt"
awk '{print} /^[[:space:]]*FROM[[:space:]]/ {
  print "COPY --from=sandboxca sandbox-ca.crt /usr/local/share/ca-certificates/sandbox-ca.crt"
  print "RUN (update-ca-certificates || cat /usr/local/share/ca-certificates/sandbox-ca.crt >> /etc/ssl/certs/ca-certificates.crt) >/dev/null 2>&1 || true"
  print "ENV NODE_EXTRA_CA_CERTS=/usr/local/share/ca-certificates/sandbox-ca.crt"
}' "$dockerfile" > "$tmp/Dockerfile"
exec docker build --network host --build-context sandboxca="$tmp" \
  --build-arg HTTPS_PROXY="${HTTPS_PROXY:-}" --build-arg HTTP_PROXY="${HTTP_PROXY:-}" \
  --build-arg https_proxy="${HTTPS_PROXY:-}" --build-arg http_proxy="${HTTP_PROXY:-}" \
  -f "$tmp/Dockerfile" "${out[@]}"
HELPER
chmod +x /usr/local/bin/docker-build-sandbox

echo "setup complete: $(dotnet --version 2>/dev/null) / eas $(eas --version 2>/dev/null | head -1)"
