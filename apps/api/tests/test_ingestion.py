import json

import pymupdf
from app.worker import extract_pages, split_text


def test_pdf_extraction_preserves_hyperlink_text_and_destination():
    document = pymupdf.open()
    page = document.new_page()
    label = "Find First and Last Position of Element in Sorted Array"
    url = "https://leetcode.com/problems/find-first-and-last-position-of-element-in-sorted-array/"
    page.insert_text((72, 72), label)
    page.insert_link(
        {
            "kind": pymupdf.LINK_URI,
            "from": pymupdf.Rect(72, 58, 330, 78),
            "uri": url,
        }
    )

    extracted = extract_pages("linked-problem.pdf", document.tobytes())[0][0]

    assert f"[{label}](<{url}>)" in extracted


def test_text_extraction_supports_plain_text():
    pages = extract_pages("notes.txt", b"First line\nSecond line")
    assert len(pages) == 1
    assert "First line" in pages[0][0]
    assert pages[0][1] is None


def test_json_extraction_is_readable_and_stable():
    pages = extract_pages("record.json", json.dumps({"name": "Lumix", "active": True}).encode())
    assert '"Lumix"' in pages[0][0]
    assert '"active": true' in pages[0][0]


def test_html_extraction_ignores_scripts_and_styles():
    pages = extract_pages(
        "policy.html",
        b"<html><head><style>.x{}</style><script>alert(1)</script></head><body><h1>Policy</h1><p>Keep this.</p></body></html>",
    )
    assert "Policy" in pages[0][0]
    assert "Keep this." in pages[0][0]
    assert "alert" not in pages[0][0]


def test_csv_rows_are_separated_for_chunking():
    pages = extract_pages("table.csv", b"name,value\nLumix,1\nSearch,2")
    assert pages[0][0].splitlines() == ["name | value", "Lumix | 1", "Search | 2"]


def test_chunking_keeps_all_text_and_overlaps_chunks():
    source = " ".join(f"word{i}" for i in range(1200))
    chunks = split_text(source, size=1200, overlap=200)
    assert len(chunks) > 1
    assert chunks[0][-30:] in chunks[1]
    assert chunks[-1].endswith("word1199")
