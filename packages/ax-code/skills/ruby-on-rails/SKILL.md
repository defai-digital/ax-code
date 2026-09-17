---
name: ruby-on-rails
description: Work in Ruby on Rails apps using Zeitwerk, bundle exec, and bin/rails tests. Do not boot the Rails process for code intelligence.
argument-hint: "[file, model, or request to focus on]"
---

Edit Rails code in $ARGUMENTS. If no argument is given, start from files changed in the current branch and stay inside one coherent slice (one model + its test, one controller + its route, or one job).

## Constraints

- Do not boot the Rails application for indexing, language servers, or exploration (`rails runner`, `rails console`, `rails server`, or requiring `config/environment`).
- Do not install or enable `ruby-lsp-rails` to load the app. Use source, tests, and `bundle exec` / `bin/rails` for the requested change only.
- Prefer `bundle exec` and project binstubs over global gem binaries.
- Do not mutate `db/schema.rb` by running migrations unless the user asked for a schema change.
- Leave `vendor/`, compiled assets, and log/tmp directories alone.

## Conventions

- Follow Zeitwerk file-to-constant mapping. A constant `Billing::Invoice` lives at `app/models/billing/invoice.rb` (or the matching `app/` pack path). Do not add classic autoload `require` calls.
- Keep models, controllers, jobs, mailers, and jobs in their standard `app/` directories. Put shared POROs under `app/models` or `app/lib` only when the project already uses that layout.
- Routes live in `config/routes.rb`. Match new controller actions to an explicit route; do not assume a default resource exists.
- Prefer ActiveRecord query APIs already used in the file. Do not introduce a new ORM pattern in a one-line fix.
- Tests: use the project's runner. Prefer `bin/rails test` for Minitest and `bundle exec rspec` for RSpec. Run the smallest file or example that covers the change.
- ERB stays templates. Do not move business logic into views.

## Verification

- Run the smallest relevant test file or example.
- If the change is a migration the user requested, report the up/down pair and do not apply it to a production database.
- If no focused test exists, say so and describe the manual probe (`bin/rails runner` is not that probe).
