#!/bin/bash

echo "Generating self-signed SSL certificate..."

# Generate private key
openssl genrsa -out key.pem 2048

# Generate certificate
openssl req -new -x509 -key key.pem -out cert.pem -days 365 -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost"

echo "✅ SSL certificate generated!"
echo "Files created: key.pem, cert.pem"
echo ""
echo "Now run: node server-https.js"
echo "Access via: https://YOUR_IP:3443"