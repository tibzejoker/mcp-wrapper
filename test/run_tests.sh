#!/bin/bash

# Make script executable
chmod +x "$0"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${GREEN}MCP Wrapper Network Test Runner${NC}"
echo -e "${BLUE}=============================${NC}"
echo ""
echo "1. Run Ping Test Server"
echo "2. Run HTTP Test Server"
echo "3. Run Network Test Server (All Tests)"
echo "4. Exit"
echo ""
read -p "Select an option (1-4): " option

case $option in
  1)
    echo -e "${GREEN}Starting Ping Test Server...${NC}"
    if [ -f "dist/ping_server.bundle.js" ]; then
      node dist/ping_server.bundle.js
    else
      echo -e "${RED}Bundle not found. Running from source...${NC}"
      node ping_server.js
    fi
    ;;
  2)
    echo -e "${GREEN}Starting HTTP Test Server...${NC}"
    if [ -f "dist/http_server.bundle.js" ]; then
      node dist/http_server.bundle.js
    else
      echo -e "${RED}Bundle not found. Running from source...${NC}"
      node http_ping_server.js
    fi
    ;;
  3)
    echo -e "${GREEN}Starting Network Test Server...${NC}"
    if [ -f "dist/network_server.bundle.js" ]; then
      node dist/network_server.bundle.js
    else
      echo -e "${RED}Bundle not found. Running from source...${NC}"
      node network_test_server.js
    fi
    ;;
  4)
    echo -e "${BLUE}Exiting...${NC}"
    exit 0
    ;;
  *)
    echo -e "${RED}Invalid option. Exiting.${NC}"
    exit 1
    ;;
esac 