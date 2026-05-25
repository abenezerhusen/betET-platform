.PHONY: up down reset logs migrate seed setup shell-db shell-backend health backup install

# Start everything (DB+Backend in Docker, panels on host)
up:
	@echo "Starting PlayCore..."
	@docker compose up -d --build
	@echo "Starting panels..."
	@cd admin-panel-main   && npm install --silent && npm run dev &
	@cd user-panel-main    && npm install --silent && npm run dev &
	@cd cashier-panel-main && npm install --silent && npm run dev -- -p 3001 &
	@cd game-engine-main   && npm install --silent && npm run dev -- -p 3002 &
	@echo ""
	@echo "Admin:   http://localhost:5173"
	@echo "Users:   http://localhost:3000"
	@echo "Cashier: http://localhost:3001"
	@echo "Games:   http://localhost:3002"
	@echo "Backend: http://localhost:4000"

# Stop everything
down:
	docker compose down
	pkill -f "next dev" 2>/dev/null || true
	pkill -f "vite" 2>/dev/null || true

# Reset database completely
reset:
	docker compose down -v
	docker compose up -d
	sleep 10
	docker compose exec backend npm run migrate
	docker compose exec backend npm run seed

# Run migrations only
migrate:
	docker compose exec backend npm run migrate

# Run seed only
seed:
	docker compose exec backend npm run seed

# Run both migrations and seed
setup:
	docker compose exec backend npm run migrate
	docker compose exec backend npm run seed
	@echo ""
	@echo "Test accounts:"
	@echo "  superadmin@playcore.local / Admin@123456"
	@echo "  user@playcore.local       / Admin@123456 (ETB 5000)"

# View backend logs
logs:
	docker compose logs -f backend

# Open database shell
shell-db:
	docker compose exec postgres psql -U playcore -d playcore

# Open backend shell
shell-backend:
	docker compose exec backend sh

# Check all services health
health:
	@echo "=== Docker Services ==="
	@docker compose ps
	@echo ""
	@echo "=== Backend Health ==="
	@curl -s http://localhost:4000/api/health || echo "Backend not responding"
	@echo ""
	@echo "=== Panel Status ==="
	@curl -s -o /dev/null -w "Admin Panel:   %{http_code}\n"   http://localhost:5173  || echo "Admin: not running"
	@curl -s -o /dev/null -w "User Panel:    %{http_code}\n"   http://localhost:3000  || echo "User: not running"
	@curl -s -o /dev/null -w "Cashier Panel: %{http_code}\n"   http://localhost:3001  || echo "Cashier: not running"
	@curl -s -o /dev/null -w "Game Engine:   %{http_code}\n"   http://localhost:3002  || echo "Games: not running"

# Backup database
backup:
	docker compose exec postgres pg_dump -U playcore playcore > \
		backups/backup_$$(date +%Y%m%d_%H%M%S).sql
	@echo "Backup saved to backups/ folder"

# Install all panel dependencies
install:
	cd admin-panel-main   && npm install
	cd user-panel-main    && npm install
	cd cashier-panel-main && npm install
	cd game-engine-main   && npm install
	@echo "All dependencies installed"
