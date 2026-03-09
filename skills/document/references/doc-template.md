# Documentation Template

Use this template when generating feature documentation. Omit sections that do not apply (e.g., Screenshots when none are provided, Configuration when there is nothing to configure).

## Template

```md
# <Feature Title>

**Date:** <current date>
**Specification:** <spec_path or "N/A">

## Overview

<2-3 sentence summary of what was built and why>

## Screenshots

<Only include if screenshots were provided and copied to docs/assets/>

![<Description>](assets/<screenshot-filename.png>)

## What Was Built

<List the main components/features implemented based on the git diff analysis>

- <Component/feature 1>
- <Component/feature 2>

## Technical Implementation

### Files Modified

<List key files changed with brief description of changes>

- `<file_path>`: <what was changed/added>
- `<file_path>`: <what was changed/added>

### Key Changes

<Describe the most important technical changes in 3-5 bullet points>

## How to Use

<Step-by-step instructions for using the new feature>

1. <Step 1>
2. <Step 2>

## Configuration

<Any configuration options, environment variables, or settings. Omit if none.>

## Testing

<Brief description of how to test the feature>

## Notes

<Any additional context, limitations, or future considerations. Omit if none.>
```

