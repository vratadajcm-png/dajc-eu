---
title: "DAJC Starts an eFTI Certification-Readiness Programme"
description: "DAJC has added a formal eFTI certification-readiness programme to its architecture, keeping the D-ID canonical while preparing for regulated EU freight-information exchange."
slug: "efti-certification-readiness"
category: "platform"
publishedAt: 2026-09-17
language: "en"
author: "DAJC"
status: "published"
sources:
  - name: "European Commission — The eFTI Regulation"
    url: "https://transport.ec.europa.eu/transport-themes/logistics-and-multimodal-transport/efti-regulation_en"
  - name: "EUR-Lex — Commission Implementing Regulation (EU) 2025/2243"
    url: "https://eur-lex.europa.eu/eli/reg_impl/2025/2243/oj"
tags:
  - "eFTI"
  - "D-ID"
  - "digital freight"
  - "certification readiness"
---

DAJC has added a formal **eFTI certification-readiness programme** to the platform architecture.

The objective is to prepare DAJC so that it can apply for eFTI platform certification at the earliest practical point once the remaining EU certification rules and conformity-assessment route are operational.

This is a readiness programme — **DAJC is not claiming to be eFTI-certified today**.

## What's new

The D-ID remains the canonical DAJC transport record. Instead of creating a separate freight-information database, the eFTI layer is being designed as a regulated projection of the relevant D-ID revision.

The programme now includes work on:

- a versioned regulatory baseline and requirement traceability matrix,
- D-ID to eFTI CMDS mapping and validation,
- identity assurance and granular authorisation,
- selective disclosure to competent authorities,
- eFTI Gate / eDelivery interoperability,
- inspection-ready UIL / QR workflows,
- granular audit and transparency evidence,
- conformance, security, recovery and interoperability testing,
- and a controlled evidence package for conformity assessment.

## Why it matters

The European Commission says the eFTI Regulation will apply in full on **9 July 2027**. By then, Member State authorities must accept regulatory information shared electronically by operators via certified eFTI platforms.

The Commission also plans to adopt the remaining eFTI implementing specifications, including detailed certification rules, by **December 2026**.

For DAJC, that makes certification-readiness an architecture problem now — not something to bolt on shortly before 2027.

## D-ID stays canonical

DAJC's design principle is that one transport should not split into separate business and regulatory truths.

The current architecture therefore treats eFTI as a controlled projection from the D-ID: the applicable regulatory subset is mapped, validated, authorised and exposed to the competent authority without making the complete internal D-ID visible by default.

Unknown mandatory data must create a blocker or review state. It must never be invented.

## Hybrid first, own certification as the target

The approved direction is **hybrid → own certification**.

Before DAJC has its own certificate, a certified third-party eFTI platform or service provider may be evaluated through a provider-neutral adapter, subject to current certification evidence, interoperability, security, data-location, contractual and exit requirements.

The longer-term target is DAJC's own certification path where the final rules and the commercial/legal role make that appropriate.

## Interoperability work has started

DAJC has started technical outreach around national eFTI Gate interoperability and the EU certification path. Those discussions are part of preparation and evidence gathering; they do not constitute certification, partnership or production approval.

## What this does not mean

This update does **not** mean that DAJC is already certified, connected to every national eFTI Gate, or ready for production authority exchange.

No eFTI certification mark or public “certified” claim will be used until there is verifiable certificate evidence.

## What's next

The next steps are to keep the architecture certification-ready, build the regulatory traceability and test evidence, prepare the CMDS/identity/authorisation/audit/Gate contracts, and review the programme immediately when the Commission publishes the remaining final certification specifications.

The aim is simple: when the certification route is fully open, DAJC should be closing a defined evidence gap — not redesigning the platform from scratch.
