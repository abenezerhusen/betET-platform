#!/bin/bash

# PlayCore Local Development Startup Script

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

# Handle flags
if [ "$1" = "--stop" ]; then
    echo -e "${RED}Stopping all services...${NC}"
    docker compose down
    pkill -f "next dev" 2>/dev/null || true
    pkill -f "vite" 2>/dev/null || true
    echo -e "${GREEN}All stopped.${NC}"
    exit 0
fi

if [ "$1" = "--reset" ]; then
    echo -e "${YELLOW}Resetting database...${NC}"
    docker compose down -v
    echo -e "${GREEN}Database reset complete.${NC}"
fi

# Install dependencies if missing
install_if_needed() {
    if [ ! -d "$1/node_modules" ]; then
        echo -e "${YELLOW}Installing dependencies for $1...${NC}"
        (cd "$1" && npm install)
    fi
}

install_if_needed "admin-panel-main"
install_if_needed "user-panel-main"
install_if_needed "cashier-panel-main"
install_if_needed "game-engine-main"

# Start Docker services
echo ""
echo -e "${GREEN}Starting database and backend...${NC}"
docker compose up -d --build

# Wait for backend
echo -e "${YELLOW}Waiting for backend...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:4000/api/health > /dev/null 2>&1; then
        echo -e "${GREEN}Backend ready!${NC}"
        break
    fi
    sleep 2
    echo "  Waiting... ($((i*2))/60 seconds)"
done

# Run migrations if needed
TABLE_CHECK=$(docker compose exec -T postgres \
    psql -U playcore -d playcore -c "\dt" 2>&1)

if ! echo "$TABLE_CHECK" | grep -q "users"; then
    echo -e "${YELLOW}Running migrations and seed data...${NC}"
    docker compose exec backend npm run migrate
    docker compose exec backend npm run seed
    echo -e "${GREEN}Database ready!${NC}"
    echo ""
    echo -e "${CYAN}Test accounts:"
    echo "  superadmin@playcore.local / Admin@123456"
    echo "  admin@playcore.local      / Admin@123456"
    echo "  cashier@playcore.local    / Admin@123456"
    echo -e "  user@playcore.local       / Admin@123456 (ETB 5000 balance)${NC}"
fi

# Start all panels in background
echo ""
echo -e "${GREEN}Starting frontend panels...${NC}"

(cd admin-panel-main && npm run dev) &
(cd user-panel-main && npm run dev) &
(cd cashier-panel-main && npm run dev -- -p 3001) &
(cd game-engine-main && npm run dev -- -p 3002) &

# Print summary
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  PlayCore is starting up!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}  Wait ~30 seconds for all panels to compile${NC}"
echo ""
echo -e "${CYAN}  Admin Panel  -> http://localhost:5173${NC}"
echo -e "${CYAN}  User Panel   -> http://localhost:3000${NC}"
echo -e "${CYAN}  Cashier      -> http://localhost:3001${NC}"
echo -e "${CYAN}  Game Engine  -> http://localhost:3002${NC}"
echo -e "${CYAN}  Backend API  -> http://localhost:4000${NC}"
echo -e "${CYAN}  API Docs     -> http://localhost:4000/api-docs${NC}"
echo ""
echo "  To stop everything:  ./start-local.sh --stop"
echo "  To reset database:   ./start-local.sh --reset"
echo ""

# Keep script running so Ctrl+C stops everything
wait
