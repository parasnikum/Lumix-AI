import asyncio

import boto3
from botocore.exceptions import ClientError

from app.core.config import settings


def _client():
    return boto3.client(
        "s3",
        endpoint_url=settings.s3_endpoint_url or None,
        aws_access_key_id=settings.s3_access_key,
        aws_secret_access_key=settings.s3_secret_key.get_secret_value(),
        region_name=settings.s3_region,
    )


def _ensure_bucket(client) -> None:
    try:
        client.head_bucket(Bucket=settings.s3_bucket)
        return
    except ClientError as exc:
        status_code = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
        error_code = exc.response.get("Error", {}).get("Code")
        if status_code != 404 and error_code not in {"NoSuchBucket", "NotFound"}:
            raise

    create_args = {"Bucket": settings.s3_bucket}
    if settings.s3_region != "us-east-1":
        create_args["CreateBucketConfiguration"] = {"LocationConstraint": settings.s3_region}
    client.create_bucket(**create_args)


async def put_object(key: str, content: bytes, content_type: str) -> None:
    def upload():
        client = _client()
        _ensure_bucket(client)
        client.put_object(
            Bucket=settings.s3_bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
        )

    await asyncio.to_thread(upload)


async def delete_object(key: str) -> None:
    await asyncio.to_thread(_client().delete_object, Bucket=settings.s3_bucket, Key=key)


async def signed_download_url(key: str, filename: str) -> str:
    return await asyncio.to_thread(
        _client().generate_presigned_url,
        "get_object",
        Params={
            "Bucket": settings.s3_bucket,
            "Key": key,
            "ResponseContentDisposition": f'attachment; filename="{filename}"',
        },
        ExpiresIn=300,
    )
