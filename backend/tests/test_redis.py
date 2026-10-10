"""Shared-cache integration test against CI's isolated Redis service."""

import os

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("POLICYLENS_TEST_REDIS_URL"), reason="Redis integration service not configured"
)


async def test_shared_response_cache(svc):
    from conftest import TestEmbedder
    from policylens.models import Query
    from policylens.service import Service
    from redis.asyncio import Redis

    svc.redis = Redis.from_url(os.environ["POLICYLENS_TEST_REDIS_URL"], decode_responses=True)
    other = Service(svc.config, TestEmbedder())
    other.redis = Redis.from_url(os.environ["POLICYLENS_TEST_REDIS_URL"], decode_responses=True)
    query = Query(question="What receipts are required?", document_id="policy-1")
    first = await svc.answer(query)
    second = await other.answer(query)
    assert not first.cached and second.cached
    assert first.claims == second.claims
    await svc.redis.aclose()
    await other.redis.aclose()
    other.store.engine.dispose()
