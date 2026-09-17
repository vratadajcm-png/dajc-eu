---
title: "DAJC Moves from Integration Outreach to Verified Technical Pathways"
description: "A month of technical exchanges with transport authorities, OEM data systems and infrastructure providers has turned several DAJC integration areas into documented implementation pathways — while keeping provider and jurisdiction limits explicit."
slug: "integration-paths-september-2026"
category: "platform"
publishedAt: 2026-09-18
language: "en"
author: "DAJC"
status: "published"
tags:
  - "integrations"
  - "Provider Orchestrator"
  - "permits"
  - "customs"
  - "vehicle data"
  - "road intelligence"
---

During the past month, DAJC has moved several integration workstreams from general provider research into **documented technical pathways**.

That does not mean every connector is live. It means that, for a growing number of transport systems and data sources, DAJC now has concrete information about how access, customer authorisation, test environments, interfaces, licensing or implementation constraints actually work.

This distinction is important to the way DAJC is being built.

## Provider-neutral does not mean provider-generic

DAJC is designed around a Provider Orchestrator rather than a single-vendor dependency. But every provider and every public authority has its own technical and legal boundary.

Over the last month, technical exchanges have reinforced several different connection patterns:

- customer-authorised vehicle and fleet data using customer-owned accounts or credentials,
- developer or partner APIs with provider-specific onboarding,
- official open-data and national-access-point feeds,
- authority interfaces that require a dedicated communication client,
- test or preview environments for port, permit or transport systems,
- indirect access through an authorised service provider,
- and jurisdictions where no machine-to-machine write interface is currently available.

DAJC therefore cannot treat "integration" as one universal API pattern.

## Vehicle and fleet data

The vehicle-data layer has progressed from a generic multi-OEM concept into provider-specific onboarding paths.

Publicly listed DAJC Integration Ecosystem entries such as **Scania Data Access** and **RIO / MAN** remain marked as integration work in progress. Their technical paths are being designed around customer authorisation rather than DAJC taking ownership of a customer's vehicle-data relationship.

**DAF / PACCAR Connect** and **Volvo / Renault** remain at an earlier discussion or onboarding stage. Their presence in the Integration Ecosystem reflects the current documented status, not a claim of production connectivity or commercial partnership.

## Permits: direct automation where possible, controlled fallback where it is not

Permit systems differ substantially between jurisdictions.

For some systems, DAJC has received technical material describing machine-to-machine or API-based interfaces and can design a provider-specific Permit Hub adapter around those documented capabilities.

Other authorities currently do not expose a write interface for third-party software. DAJC must therefore support a controlled fallback workflow: prepare and validate the transport data and document package, guide the user through the official authority process, preserve evidence and status, and avoid pretending that a direct submission occurred when it did not.

This is now an explicit architectural principle: **the Permit Hub follows the real capability of each jurisdiction rather than forcing every country into the same integration model.**

## Customs and transit

The same principle applies to customs.

The current Czech NCTS/COMIN workstream has established a concrete technical route based on DAJC operating its own communication client while keeping declarant identities, authorisations and data separated appropriately.

That is different from a generic customs API and will be implemented as a jurisdiction- and authority-specific connector behind the same DAJC workflow layer.

## Road intelligence and secure parking

Road and parking intelligence is also becoming more evidence-driven.

DAJC is working with official national access points, road-data platforms, geospatial authorities and secure-parking organisations to understand not only what data exist, but also their identifiers, update mechanisms, provenance, licensing and operational meaning for abnormal transport.

Where an official source does not distinguish an attribute that matters to heavy or oversized transport, DAJC will not silently infer it as fact. Provider data and any DAJC-specific enrichment must remain distinguishable and traceable.

## Weather is a useful example of the model

The Meteosource workstream shows the intended separation clearly: source weather data remain attributed to the provider, while DAJC may build transport-specific indicators and warnings on top of those data for a particular vehicle, cargo and route.

The public Integration Ecosystem therefore describes the integration status without presenting DAJC-generated transport intelligence as provider-generated advice.

## What an Integration Ecosystem status means

A provider being listed by DAJC can mean that a technical path, discussion or onboarding process is active. It does **not** automatically mean:

- a production connector is live,
- DAJC has a commercial partnership with that organisation,
- the provider endorses DAJC,
- customer data can already be accessed,
- or the same licensing and data rights apply to every customer or jurisdiction.

Production activation remains subject to the relevant security, privacy, customer-authorisation, licensing, commercial and operational gates.

## Why this matters

The value of the Provider Orchestrator is not the number of logos connected to it. Its value is that DAJC can represent the real differences between systems while still giving the transport user one operational workflow around the D-ID.

A vehicle-data provider, a national permit authority, a customs interface, a road-data source and an eFTI Gate do not work the same way — and DAJC should not pretend that they do.

The integration work completed during the past month gives the platform a stronger evidence base for that architecture.

## What's next

DAJC will continue turning provider-specific evidence into connector specifications and testable adapters. Each integration will keep its own readiness, capability and authorisation state, and public wording will continue to distinguish technical preparation from live production use.

The goal remains consistent: **one D-ID and one execution workflow, connected to the right external system in the way that system actually permits.**
