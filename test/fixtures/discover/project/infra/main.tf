terraform {
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare" }
    google     = { source = "hashicorp/google" }
  }
}
provider "azurerm" {
  features {}
}
