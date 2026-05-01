class Asp < Formula
  desc "Run and inspect local Agent Session Protocol networks"
  homepage "https://github.com/RobotNetworks/asp/tree/main/cli"
  url "https://registry.npmjs.org/@robotnetworks/asp/-/asp-0.0.0.tgz"
  sha256 "REPLACE_WITH_ACTUAL_SHA256"
  license "Apache-2.0"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/asp --version")
  end
end
