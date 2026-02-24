import argparse
import asyncio
from getpass import getpass

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Tenant, TenantMembership, TenantRole, User
from app.security import hash_password

PLATFORM_TENANT_SLUG = "lumix-platform-internal"


async def create_super_admin(email: str, full_name: str):
    async with SessionLocal() as db:
        normalized_email = email.strip().lower()
        user = await db.scalar(select(User).where(User.email == normalized_email))
        if user:
            user.is_super_admin = True
            print(f"Granted platform administrator access to {normalized_email}")
        else:
            password = getpass("New administrator password (min 10 characters): ")
            if len(password) < 10:
                raise SystemExit("Password must contain at least 10 characters")
            user = User(
                email=normalized_email,
                full_name=full_name.strip(),
                password_hash=hash_password(password),
                is_super_admin=True,
            )
            db.add(user)
            await db.flush()

        platform_tenant = await db.scalar(select(Tenant).where(Tenant.slug == PLATFORM_TENANT_SLUG))
        if not platform_tenant:
            platform_tenant = Tenant(name="Lumix Platform", slug=PLATFORM_TENANT_SLUG)
            db.add(platform_tenant)
            await db.flush()
        membership = await db.scalar(
            select(TenantMembership.id).where(
                TenantMembership.tenant_id == platform_tenant.id,
                TenantMembership.user_id == user.id,
            )
        )
        if not membership:
            db.add(
                TenantMembership(
                    tenant_id=platform_tenant.id, user_id=user.id, role=TenantRole.owner
                )
            )
        await db.commit()
        print("Platform administrator is ready. Sign in through the Lumix login page.")


def main():
    parser = argparse.ArgumentParser(description="Lumix administration commands")
    subparsers = parser.add_subparsers(dest="command", required=True)
    admin = subparsers.add_parser("create-super-admin")
    admin.add_argument("--email", required=True)
    admin.add_argument("--name", required=True)
    args = parser.parse_args()
    if args.command == "create-super-admin":
        asyncio.run(create_super_admin(args.email, args.name))


if __name__ == "__main__":
    main()
